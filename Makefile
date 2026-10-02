# Everything runs in Docker, nothing is installed on the host. Override the
# image in local.mk (git-ignored), e.g.: DOCKER_IMAGE := my-image
DOCKER_IMAGE ?= node:22
-include local.mk

DOCKER  := docker run --rm -v "$(CURDIR):/current" --workdir /current $(DOCKER_IMAGE)
WEB_EXT := npx --yes web-ext@latest

# Files that don't belong in the AMO package. web-ext skips dotfiles and its
# own artifacts dir by itself, but not git-ignored files like local.mk.
IGNORE  := "scripts" "scripts/**" "store" "store/**" Makefile README.md CHANGELOG.md local.mk

VERSION := $(shell sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
ZIP     := web-ext-artifacts/root_ca_tracker-$(VERSION).zip

.PHONY: build lint check roots clean

## build: syntax check, lint, then package the extension for AMO
build: check lint
	$(DOCKER) $(WEB_EXT) build --overwrite-dest --ignore-files $(IGNORE)
	@# List what ships, so a stray file is caught before upload.
	unzip -l $(ZIP)
	@echo "Upload: $(ZIP)"

## lint: Mozilla's validator, the same checks AMO runs on upload
lint:
	$(DOCKER) $(WEB_EXT) lint --ignore-files $(IGNORE)

## check: syntax-check all JavaScript
check:
	$(DOCKER) sh -c 'for f in *.js scripts/*.js; do node --check "$$f" || exit 1; done'

## roots: refresh the bundled mozilla-roots.json from CCADB
roots:
	$(DOCKER) node scripts/update-mozilla-roots.js

clean:
	rm -rf web-ext-artifacts
