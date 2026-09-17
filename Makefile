PORT ?= 8080
HOST ?= 127.0.0.1

.PHONY: serve

serve:
	python3 -m http.server "$(PORT)" --bind "$(HOST)"
