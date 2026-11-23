.PHONY: hooks compile test pack-check

hooks:
	@mkdir -p .git/hooks
	@cp .githooks/pre-commit .git/hooks/pre-commit
	@cp .githooks/post-commit .git/hooks/post-commit
	@cp .githooks/pre-push .git/hooks/pre-push
	@chmod +x .githooks/pre-commit .githooks/post-commit .githooks/pre-push \
	          .git/hooks/pre-commit .git/hooks/post-commit .git/hooks/pre-push
	@echo "Installed git hooks into .git/hooks/"

compile:
	npm run compile

test:
	npm test

pack-check:
	npm pack --dry-run
