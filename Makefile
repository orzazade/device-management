# Device Management — local workflows.
#
# Two ways to run the system:
#
#   make up + make dev-api + make dev-web    datastores in Docker, apps on the
#                                            host with hot reload. Daily loop.
#
#   make full                                everything in containers, built
#                                            from the production images, on
#                                            http://localhost:8088. Use this to
#                                            check what actually ships.
#
# `make` on its own lists every target.

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help
COMPOSE := docker compose

# Passed through to pytest by `make e2e`, e.g. `make e2e ARGS="-m smoke"`.
ARGS ?=

.PHONY: help install up down ps logs dev-api dev-web full full-build full-down \
        full-logs full-restart build lint test check e2e db-reset clean

help: ## List available targets
	@echo "Device Management — make targets:"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo

install: ## Install workspace dependencies
	pnpm install

# ----------------------------------------------------------- host development

up: ## Start Postgres + Redis only (apps run on the host)
	$(COMPOSE) up -d
	@echo "postgres :5433   redis :6380"

down: ## Stop compose services, keeping the database volume
	$(COMPOSE) --profile full down

ps: ## Show compose service status
	$(COMPOSE) --profile full ps

logs: ## Tail logs from the datastores
	$(COMPOSE) logs -f

dev-api: ## Run the API on the host with watch mode (:8080)
	pnpm dev:api

dev-web: ## Run Vite on the host (:5173, proxies /api to :8080)
	pnpm dev:web

# -------------------------------------------------------- full containerised

full: ## Build and start the whole stack in containers (http://localhost:8088)
	$(COMPOSE) --profile full up -d --build
	@echo
	@echo "  app      http://localhost:8088"
	@echo "  health   http://localhost:8088/api/v1/health"
	@echo
	@echo "The api runs migrations on boot; give it a few seconds on a fresh volume."

full-build: ## Build the api and web images without starting anything
	$(COMPOSE) --profile full build

full-down: ## Stop the containerised stack, keeping the database volume
	$(COMPOSE) --profile full down

full-logs: ## Tail logs from every container in the stack
	$(COMPOSE) --profile full logs -f

full-restart: ## Rebuild and restart api + web after a code change
	$(COMPOSE) --profile full up -d --build api web

# --------------------------------------------------------------- build / test

build: ## Compile both apps (tsc + vite build)
	pnpm build

lint: ## Lint both apps
	pnpm lint

test: ## Run the Vitest suites (API)
	pnpm test

check: lint test build ## Everything CI runs, in CI's order

e2e: ## Run the Selenium suite — see note below. `make e2e ARGS="-m smoke"`
	@# run-e2e.sh drives Homebrew postgresql@17 and redis on the DEFAULT ports
	@# (5432/6379) and starts the apps as host processes. It does not use the
	@# compose datastores on 5433/6380 — the two are separate worlds on purpose.
	cd e2e && ./run-e2e.sh $(ARGS)

# ---------------------------------------------------------------- destructive

db-reset: ## Delete the local Postgres volume — all local data is lost
	@printf 'This deletes the compose Postgres volume and every row in it. Continue? [y/N] '; \
	read ans; [ "$$ans" = "y" ] || { echo "aborted"; exit 1; }
	$(COMPOSE) --profile full down -v
	@echo "volume gone — the next 'make up' starts from migrations again"

clean: ## Remove build output and node_modules
	rm -rf apps/api/dist apps/web/dist
	rm -rf node_modules apps/api/node_modules apps/web/node_modules
