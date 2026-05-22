package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/gorilla/websocket"
	"github.com/xmx/muxconn"
	"golang.org/x/time/rate"
)

type Manager struct {
	next   http.Handler // 虚拟连接内部的 http server
	wsu    *websocket.Upgrader
	mutex  sync.RWMutex
	pools  map[string]muxconn.Muxer
	serial atomic.Int64
}

func NewManager(next http.Handler) *Manager {
	return &Manager{
		next: next,
		wsu: &websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		pools: make(map[string]muxconn.Muxer, 16),
	}
}

// Accept 客户端认证上线接口。
func (pl *Manager) Accept(w http.ResponseWriter, r *http.Request) {
	ws, err := pl.wsu.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket 升级失败:", "err", err)
		return
	}

	conn := ws.NetConn()
	parent := context.Background()

	var mux muxconn.Muxer
	query := r.URL.Query()
	proto := query.Get("protocol")
	switch proto {
	case "smux":
		mux, err = muxconn.NewSMUX(parent, conn, nil, true)
	default:
		mux, err = muxconn.NewYaMUX(parent, conn, nil, true)
	}
	if err != nil {
		_ = ws.Close()
		slog.Error("协议包装失败:", "err", err)
		return
	}

	// 这里为了演示方便，服务端通过自增序列生成了客户端 ID，
	// 实际使用时，请结合业务认证通过后，得到客户端唯一标识。
	id := strconv.FormatInt(pl.serial.Add(1), 10)
	protocol, module := mux.Library()

	pl.mutex.Lock()
	pl.pools[id] = mux
	pl.mutex.Unlock()

	defer func() {
		_ = mux.Close()

		pl.mutex.Lock()
		delete(pl.pools, id)
		pl.mutex.Unlock()

		slog.Info("客户端下线了:", "id", id, "protocol", protocol, "module", module, "err", err)
	}()

	slog.Info("客户端上线成功:", "id", id, "protocol", protocol, "module", module)
	srv := &http.Server{Handler: pl.next}
	err = srv.Serve(mux)
}

// Clients 客户端列表
func (pl *Manager) Clients(w http.ResponseWriter, r *http.Request) {
	pl.mutex.RLock()
	defer pl.mutex.RUnlock()

	ret := make([]*ClientStat, 0, 10)
	for id, mux := range pl.pools {
		proto, module := mux.Library()
		bps := mux.Limit()
		rx, tx := mux.Traffic()
		cumulative, active := mux.NumStreams()
		stms := mux.Streams()

		stat := &ClientStat{
			ID:         id,
			Protocol:   proto,
			Module:     module,
			Limit:      float64(bps),
			Unlimit:    bps == rate.Inf,
			RX:         tx, // 服务端侧统计客户端流量，RX TX 要交换位置
			TX:         rx, // 服务端侧统计客户端流量，RX TX 要交换位置
			Cumulative: cumulative,
			Active:     active,
		}
		for _, stm := range stms {
			ss := stm.Stats()
			ss.RX, ss.TX = ss.TX, ss.RX // 服务端侧统计客户端流量，RX TX 要交换位置
			stat.Streams = append(stat.Streams, ss)
		}

		ret = append(ret, stat)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ret)
}

// Limit 对客户端限流
func (pl *Manager) Limit(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	req := &LimitRequest{
		ID:    query.Get("id"),
		Limit: query.Get("limit"),
	}
	bcnt, err := req.Bytes()
	if err != nil {
		slog.Error("限流字段错误", "limit", req.Limit, "err", err)
		return
	}

	pl.mutex.RLock()
	mux := pl.pools[req.ID]
	pl.mutex.RUnlock()

	if mux == nil {
		slog.Error("客户端不存在", "id", req.ID)
		return
	}

	mux.SetLimit(rate.Limit(bcnt))

	slog.Error("客户端流量配置成功", "id", req.ID, "limit", req.Limit)
}

// Limit 对客户端限流
func (pl *Manager) Direct(w http.ResponseWriter, r *http.Request) {
	ru := r.URL
	query := ru.Query()
	id := query.Get("id")

	pl.mutex.RLock()
	mux := pl.pools[id]
	pl.mutex.RUnlock()

	if mux == nil {
		slog.Error("客户端不存在", "id", id)
		return
	}

	path := "/" + r.PathValue("path")
	ru.Scheme = "http" // 内部通道使用 http 协议
	ru.Host = "virtual.internal"
	ru.Path = path // 改写路径

	// 这里为了方便演示，每次都新建了 ReverseProxy，
	// 实际使用时请尽量复用。
	prx := httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
		},
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return mux.Open(ctx)
			},
		},
	}

	prx.ServeHTTP(w, r)
}
