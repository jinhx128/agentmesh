NPM ?= npm
ROOT := $(CURDIR)
AGENTMESH := node $(ROOT)/dist-node/packages/cli/src/cli.js

.PHONY: test check smoke node-test

test:
	$(NPM) test

node-test:
	$(NPM) test

check:
	$(NPM) test

smoke:
	$(NPM) run build
	@set -eu; \
	tmp_dir="$$(mktemp -d "$${TMPDIR:-/tmp}/agentmesh-make-smoke.XXXXXX")"; \
	config="$${tmp_dir}/agentmesh.toml"; \
	printf '%s\n' \
	  'schema_version = 1' \
	  '' \
	  '[agents.reviewer]' \
	  'label = "Fake Reviewer"' \
	  'adapter = "command"' \
	  'command = "$(ROOT)/examples/fake-agent.sh"' \
	  'args = []' \
	  'aliases = ["critic"]' \
	  'capabilities = ["plan", "execute", "review", "decide"]' \
	  'prompt_file_arg = "--prompt-file"' \
	  'output_file_arg = "--output-file"' \
	  > "$${config}"; \
	cd "$${tmp_dir}"; \
	$(AGENTMESH) --config "$${config}" flow run \
	  --plan critic \
	  --execute reviewer \
	  --review critic \
	  --decide reviewer \
	  --task "make smoke" \
	  --run-id make-smoke; \
	$(AGENTMESH) --config "$${config}" flow dispatch make-smoke --stage all; \
	$(AGENTMESH) --config "$${config}" flow status make-smoke
