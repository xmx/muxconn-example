package main

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/xmx/muxconn"
)

func main() {
	parent := context.Background()
	addrs := []string{
		"http://localhost:9999/api/tunnel?protocol=smux", // 服务端暴露的接入端点
	}

	virtual := NewVirtual() // 客户端侧：虚拟通道内的 HTTP 处理器
	mux, err := muxconn.DialContext(parent, addrs, nil)
	if err != nil {
		slog.Error("连接服务端出错", "err", err)
		return
	}
	defer mux.Close()

	protocol, module := mux.Library()
	slog.Info("连接服务端成功", "protocol", protocol, "module", module)

	//cli := &http.Client{
	//	Transport: &http.Transport{
	//		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
	//			return mux.Open(ctx)
	//		},
	//	},
	//}

	//go func() {
	//	ticker := time.NewTicker(time.Second)
	//	defer ticker.Stop()
	//
	//	for range ticker.C {
	//		//res, _ := cli.Get("http://hi.internal/api/ping")
	//		//if res != nil {
	//		//	io.Copy(io.Discard, res.Body)
	//		//	res.Body.Close()
	//		//}
	//
	//		stms := mux.Streams()
	//		fmt.Printf("NUM: %d\n", len(stms))
	//	}
	//}()

	srv := &http.Server{Handler: virtual}
	err = srv.Serve(mux)

	slog.Error("客户端掉线了", "protocol", protocol, "module", module, "err", err)
}
