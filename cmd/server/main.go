package main

import "net/http"

func main() {
	virtual := NewVirtual() // 服务器侧：虚拟通道内的 HTTP 处理器
	mgt := NewManager(virtual)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/tunnel", mgt.Accept)
	mux.HandleFunc("/api/clients", mgt.Clients)         // 查看客户端状态
	mux.HandleFunc("/api/limit", mgt.Limit)             // 对客户端限流
	mux.HandleFunc("/api/direct/{path...}", mgt.Direct) // 浏览器直连客户端虚拟通道服务

	http.ListenAndServe(":9999", mux)
}
