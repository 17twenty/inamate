package config

import (
	"github.com/kelseyhightower/envconfig"
)

type Config struct {
	Port           int    `envconfig:"PORT" default:"8080"`
	DatabaseURL    string `envconfig:"DATABASE_URL" default:"postgres://inamate:inamate_dev@localhost:5433/inamate?sslmode=disable"`
	JWTSecret      string `envconfig:"JWT_SECRET" default:"dev-secret-change-in-production"`
	AssetDir       string `envconfig:"ASSET_DIR" default:"./data/assets"`
	FfmpegPath     string `envconfig:"FFMPEG_PATH" default:"ffmpeg"`
	AllowedOrigins string `envconfig:"ALLOWED_ORIGINS" default:"http://localhost:5173,http://localhost:3000"`
}

func Load() (*Config, error) {
	var cfg Config
	if err := envconfig.Process("", &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
