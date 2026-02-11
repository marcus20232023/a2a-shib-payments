# ClawHub Publication

The A2A SHIB Payment System is published on ClawHub, the OpenClaw skills directory.

## Installation

```bash
clawhub install a2a-payments
```

## Published Details

- **Slug:** a2a-payments
- **Version:** 2.0.0
- **ID:** k978a508b230tz56nkq32rkrvd80yxfx
- **Tags:** payments, blockchain, polygon, escrow, a2a
- **Published:** 2026-02-11

## ClawHub Commands

### Search
```bash
clawhub search "payment"
clawhub search "polygon"
clawhub search "escrow"
```

### Install
```bash
# Latest version
clawhub install a2a-payments

# Specific version
clawhub install a2a-payments --version 2.0.0
```

### Update
```bash
# Update to latest
clawhub update a2a-payments

# Update all skills
clawhub update --all
```

### List Installed
```bash
clawhub list
```

## For OpenClaw Users

This skill can be used with any OpenClaw agent. Once installed:

1. **Automatic discovery** - OpenClaw can find and use the skill
2. **A2A integration** - Communicates via A2A protocol
3. **Framework-agnostic** - Also works with LangChain, Bedrock, AutoGen

## Links

- **ClawHub:** https://clawhub.com
- **Skill on ClawHub:** https://clawhub.com/skills/a2a-payments
- **GitHub:** https://github.com/marcus20232023/a2a-payments
- **Documentation:** See README.md and SKILL.md

## Publishing Updates

To publish a new version:

```bash
# Make changes
git commit -am "Update: new feature"

# Bump version in package.json
npm version patch  # or minor, major

# Publish to ClawHub
clawhub publish . --slug a2a-payments \
  --name "A2A SHIB Payment System" \
  --version X.Y.Z \
  --changelog "What changed"

# Push to GitHub
git push origin master --tags
```

## Metadata

The skill includes OpenClaw metadata in SKILL.md:

```yaml
metadata:
  openclaw:
    requires: 
      bins: ["node", "npm"]
    install:
      - id: node-deps
        kind: node
        package: "."
        label: "Install dependencies (npm install)"
    tags: ["payments", "blockchain", "polygon", "shib", "escrow", "a2a", "agent-to-agent", "crypto", "web3"]
```

This enables automatic dependency installation and proper categorization.

## Distribution Channels

Your skill is now available via:

1. ✅ **GitHub** - Direct clone/fork
2. ✅ **ClawHub** - One-command install for OpenClaw
3. ⏳ **Awesome Lists** - Pending review (PR #23)
4. 🔮 **npm** - (Optional future publication)

---

**Built with 🦪 for the agent economy**
