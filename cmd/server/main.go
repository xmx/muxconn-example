package main

import (
	"fmt"
	"net/http"
)

func main() {
	virtual := NewVirtual() // 服务器侧：虚拟通道内的 HTTP 处理器
	mgt := NewManager(virtual)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/tunnel", mgt.Accept)
	mux.HandleFunc("/api/clients", mgt.Clients)         // 查看客户端状态
	mux.HandleFunc("/api/limit", mgt.Limit)             // 对客户端限流
	mux.HandleFunc("/api/kill", mgt.Kill)               // 结束某个客户端的某个子流
	mux.HandleFunc("/api/direct/{path...}", mgt.Direct) // 浏览器直连客户端虚拟通道服务
	mux.Handle("/", http.FileServer(http.Dir("webui")))

	fmt.Println("浏览器访问：http://localhost:9999")
	http.ListenAndServe(":9999", mux)
}
