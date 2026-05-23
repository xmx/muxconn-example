package main

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/xmx/muxconn"
	"golang.org/x/time/rate"
)

type ClientStat struct {
	ID          string                 `json:"id"`           // ID
	Protocol    string                 `json:"protocol"`     // 连接协议
	Module      string                 `json:"module"`       // 使用的 Go 库（调试排查用）
	Limit       float64                `json:"limit"`        // 通道限流
	Unlimit     bool                   `json:"unlimit"`      // 是否不限流（由于 Limit 是 float64 不方便分辨）
	RX          uint64                 `json:"rx"`           // 客户端接收字节数
	TX          uint64                 `json:"tx"`           // 客户端发送字节数
	Cumulative  int64                  `json:"cumulative"`   // 累计建立子流个数
	Active      int64                  `json:"active"`       // 当前活跃子流个数
	ConnectedAt time.Time              `json:"connected_at"` // 通道建立时间
	Streams     []*muxconn.StreamStats `json:"streams"`      // 当前活跃子流信息
}

type LimitRequest struct {
	ID    string `json:"id"    query:"limit"`
	Limit string `json:"limit" query:"limit"`
}

func (l LimitRequest) Bytes() (float64, error) {
	var bc ByteCount
	if err := bc.UnmarshalBind(l.Limit); err != nil {
		return 0, err
	}

	return float64(bc), nil
}

type ByteCount float64

func (bc *ByteCount) UnmarshalText(text []byte) error {
	return bc.UnmarshalBind(string(text))
}

func (bc *ByteCount) UnmarshalBind(str string) error {
	str = strings.ToLower(strings.TrimSpace(str))
	if str == "inf" {
		*bc = ByteCount(rate.Inf)
		return nil
	}

	input := []byte(str)
	var idx int
	for _, r := range input {
		if (r >= '0' && r <= '9') || r == '.' || r == '+' || r == '-' {
			idx++
			continue
		}
		break
	}

	numeric := strings.TrimSpace(string(input[:idx]))
	unit := strings.TrimSpace(string(input[idx:]))
	unit = strings.ToLower(unit)
	if numeric == "" {
		return errors.New("missing numeric value")
	}

	val, err := strconv.ParseFloat(numeric, 64)
	if err != nil {
		return err
	}

	switch unit {
	case "", "b":
	case "k", "kb", "kib":
		val *= 1024
	case "m", "mb", "mib":
		val *= 1024 * 1024
	case "g", "gb", "gib":
		val *= 1024 * 1024 * 1024
	case "t", "tb", "tib":
		val *= 1024 * 1024 * 1024 * 1024
	default:
		return errors.New("invalid unit: " + unit)
	}
	*bc = ByteCount(val)

	return nil
}
