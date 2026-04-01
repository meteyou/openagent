#!/bin/bash
set -e

echo "[openagent] Starting entrypoint..."

# Ensure data directories exist
mkdir -p /data/db /data/config /data/memory/daily /data/skills /data/npm-global /workspace

# Fix ownership on first run or after migration from root user
if [ "$(stat -c '%u' /workspace)" = "0" ]; then
    echo "[openagent] Migrating workspace ownership to agent user..."
    chown -R agent:agent /workspace
fi

if [ "$(stat -c '%u' /data)" = "0" ]; then
    echo "[openagent] Migrating data ownership to agent user..."
    chown -R agent:agent /data
fi

# Set up home defaults if missing (volume overlays image content on first run)
if [ ! -f /workspace/.bashrc ]; then
    cp /etc/skel/.bashrc /workspace/.bashrc
    chown agent:agent /workspace/.bashrc
fi

if [ ! -d /workspace/.ssh ]; then
    gosu agent mkdir -p -m 700 /workspace/.ssh
fi

# Install user-defined packages from packages.txt
PACKAGES_FILE="/data/packages.txt"
if [ -f "$PACKAGES_FILE" ]; then
    echo "[openagent] Found $PACKAGES_FILE, checking for packages to install..."
    while IFS= read -r package || [ -n "$package" ]; do
        # Skip empty lines and comments
        package=$(echo "$package" | xargs)
        if [ -z "$package" ] || [[ "$package" == \#* ]]; then
            continue
        fi

        echo "[openagent] Installing package: $package"
        apt-get update -qq && apt-get install -y -qq "$package" 2>/dev/null || {
            echo "[openagent] Warning: Failed to install package '$package'"
        }
    done < "$PACKAGES_FILE"
    echo "[openagent] Package installation complete."
else
    echo "[openagent] No $PACKAGES_FILE found, skipping package installation."
fi

# Start the application as agent user
echo "[openagent] Starting server as agent user..."
cd /app
exec gosu agent npm run start --workspace=packages/web-backend
