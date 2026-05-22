package main

import (
	"crypto/rand"
	"io"
	"net/http"
	"strconv"
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
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("hello233\n"))
	})

	// curl -L "http://127.0.0.1:9999/api/direct/api/download?id=" -o /dev/null

	return mux
}
