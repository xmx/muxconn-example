package main

import (
	"crypto/rand"
	"net/http"
)

func NewVirtual() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 40960) // 40K
		rand.Read(buf)
		w.Write(buf)
	})

	return mux
}
