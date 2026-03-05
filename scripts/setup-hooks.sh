#!/bin/bash
set -euo pipefail

SETTINGS_FILE="$HOME/.claude/settings.json"
DASHBOARD_URL="${1:-http://localhost:3000}"

echo "Setting up Claude Code hooks for dashboard at: $DASHBOARD_URL"
echo ""
echo "This will add HTTP hooks to: $SETTINGS_FILE"
echo ""

if [ ! -f "$SETTINGS_FILE" ]; then
  echo '{}' > "$SETTINGS_FILE"
fi

HOOKS_CONFIG=$(cat <<EOF
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ]
  }
}
EOF
)

echo "Hooks configuration to merge into $SETTINGS_FILE:"
echo ""
echo "$HOOKS_CONFIG" | jq .
echo ""
echo "Please add the hooks section above to your $SETTINGS_FILE"
echo ""
echo "Also set the DASHBOARD_SECRET environment variable:"
echo "  export DASHBOARD_SECRET=your-secret-here"
