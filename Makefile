# Raycast plugins monorepo
#
# Single top-level command surface for building, developing, and installing
# any number of self-contained Raycast extensions under extensions/<name>/.
#
# Run `make help` for targets. Discovery is automatic — drop a new extension
# folder into extensions/ (with its own package.json) and every target below
# picks it up without editing this Makefile.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

EXTENSIONS_DIR := extensions
EXTENSIONS := $(patsubst $(EXTENSIONS_DIR)/%/package.json,%,$(wildcard $(EXTENSIONS_DIR)/*/package.json))

.PHONY: help list deps build lint clean

help:
	@printf 'Raycast plugins monorepo\n\n'
	@printf 'Usage: make <target>\n\n'
	@printf 'Aggregate targets:\n'
	@printf '  help            Show this help (default).\n'
	@printf '  list            List discovered extensions.\n'
	@printf '  deps            npm install in every extension.\n'
	@printf '  build           ray build in every extension.\n'
	@printf '  lint            ray lint in every extension.\n'
	@printf '  clean           Remove node_modules and build artifacts.\n\n'
	@printf 'Per-extension targets (replace <name> with an extension name):\n'
	@printf '  deps-<name>     npm install for one extension.\n'
	@printf '  build-<name>    ray build for one extension.\n'
	@printf '  dev-<name>      ray develop — installs into Raycast + live reload.\n'
	@printf '  lint-<name>     ray lint for one extension.\n'
	@printf '  clean-<name>    Clean one extension.\n\n'
	@printf 'Scaffold a new extension:\n'
	@printf '  Open Raycast → run "Create Extension" → move the created folder\n'
	@printf '  into %s/ → then: make dev-<new-name>\n\n' '$(EXTENSIONS_DIR)'
	@printf 'Discovered extensions (%d):\n' '$(words $(EXTENSIONS))'
	@if [[ -z '$(strip $(EXTENSIONS))' ]]; then \
	  printf '  (none yet — drop one into %s/)\n' '$(EXTENSIONS_DIR)'; \
	else \
	  printf '  %s\n' $(EXTENSIONS); \
	fi

list:
	@if [[ -z '$(strip $(EXTENSIONS))' ]]; then exit 0; fi
	@printf '%s\n' $(EXTENSIONS)

# Sentinel rule (pattern): node_modules/.installed is rebuilt only when the
# extension's package.json changes, so build/dev/lint don't re-run `npm install`
# on every invocation.
$(EXTENSIONS_DIR)/%/node_modules/.installed: $(EXTENSIONS_DIR)/%/package.json
	@printf '→ deps: %s\n' '$*'
	@cd '$(EXTENSIONS_DIR)/$*' && npm install
	@touch '$@'

# Per-extension rules are generated explicitly via $(eval) for each discovered
# extension. Pattern rules would be terser, but GNU Make skips implicit-rule
# search for .PHONY targets — so pattern-matched phony aliases silently become
# no-ops. Explicit rules avoid that pitfall and make `make -n` output readable.
define _ext_rules
.PHONY: deps-$(1) build-$(1) dev-$(1) lint-$(1) clean-$(1)

deps-$(1): $$(EXTENSIONS_DIR)/$(1)/node_modules/.installed
	@:

build-$(1): $$(EXTENSIONS_DIR)/$(1)/node_modules/.installed
	@printf '→ build: %s\n' '$(1)'
	@cd '$$(EXTENSIONS_DIR)/$(1)' && npm run build

dev-$(1): $$(EXTENSIONS_DIR)/$(1)/node_modules/.installed
	@printf '→ dev: %s (Ctrl+C to stop; first run registers with Raycast)\n' '$(1)'
	@cd '$$(EXTENSIONS_DIR)/$(1)' && npm run dev

lint-$(1): $$(EXTENSIONS_DIR)/$(1)/node_modules/.installed
	@printf '→ lint: %s\n' '$(1)'
	@cd '$$(EXTENSIONS_DIR)/$(1)' && npm run lint

clean-$(1):
	@printf '→ clean: %s\n' '$(1)'
	@rm -rf '$$(EXTENSIONS_DIR)/$(1)/node_modules' \
	        '$$(EXTENSIONS_DIR)/$(1)/.build' \
	        '$$(EXTENSIONS_DIR)/$(1)/dist'
endef

$(foreach ext,$(EXTENSIONS),$(eval $(call _ext_rules,$(ext))))

# Aggregate targets fan out to the generated per-extension targets.
deps:  $(addprefix deps-,$(EXTENSIONS))
build: $(addprefix build-,$(EXTENSIONS))
lint:  $(addprefix lint-,$(EXTENSIONS))
clean: $(addprefix clean-,$(EXTENSIONS))
