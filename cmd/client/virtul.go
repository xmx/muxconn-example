package main

import (
	"crypto/rand"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/gorilla/websocket"
)

func NewVirtual() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/download", func(w http.ResponseWriter, r *http.Request) {
		const filesize = 10 * 1024 * 1024 * 1024 // 模拟 10G 大文件
		big := io.LimitReader(rand.Reader, filesize)

		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", strconv.FormatInt(filesize, 10))
		w.Header().Set("Content-Disposition", "attachment; filename=bigfile.dat")
		w.WriteHeader(http.StatusOK)

		io.Copy(w, big)
	})
	mux.HandleFunc("/api/chat", chat)

	// curl -L "http://127.0.0.1:9999/api/direct/api/download?id=1" -o /dev/null

	return mux
}

func chat(w http.ResponseWriter, r *http.Request) {
	upg := &websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
		return true
	}}
	ws, err := upg.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "err", err)
		return
	}
	defer ws.Close()

	ws.WriteMessage(websocket.TextMessage, []byte("你好，websocket 连接成功了"))

	for {
		typ, msg, err := ws.ReadMessage()
		if err != nil {
			slog.Error("消息读取出错", "err", err)
			return
		}

		fmt.Printf(">>> %s\n", msg)

		if err = ws.WriteMessage(typ, append([]byte("虚拟通道已收到："), msg...)); err != nil {
			slog.Error("消息回写出错", "err", err)
		}
	}

}
