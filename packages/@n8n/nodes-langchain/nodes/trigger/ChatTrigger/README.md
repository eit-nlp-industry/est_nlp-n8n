# ChatTrigger Local Development

Hosted Chat (`/webhook/.../chat`) loads `@n8n/chat` from this n8n process at `/n8n-chat-assets` by default. Point `N8N_CHAT_ASSETS_URL` at the jsDelivr URL if you need the published npm bundle instead.

## Setup

1. Build the chat widget (needed after any `@n8n/chat` source change):

```bash
pnpm --filter @n8n/chat build
```

2. Restart n8n so it can serve `packages/frontend/@n8n/chat/dist`.

3. Hard-refresh the hosted chat URL. View Source should show:

```html
<link href="/n8n-chat-assets/style.css" rel="stylesheet" />
import { createChat } from "/n8n-chat-assets/chat.bundle.es.js";
```

After a widget rebuild, hard-refresh the chat page. n8n does not need a restart unless you changed Chat Trigger / server code.

To watch the bundle while iterating on `@n8n/chat`:

```bash
cd packages/frontend/@n8n/chat
# Windows PowerShell
$env:INCLUDE_VUE="true"
pnpm exec vite build --watch
```
