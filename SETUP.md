# Roof Assistant: Setup Guide (Cloudflare)

## What's in this folder

```
roof-assistant/
├── public/                  ← files visitors' browsers download
│   ├── chat-widget.js       the chat bubble (runs on the client's website)
│   ├── server-config.json   your list of clients (name, colour, email, facts)
│   ├── demo.html            test page
│   └── _headers             lets other websites load the widget
├── functions/api/chat.js    the AI "brain" at /api/chat (holds the rules, talks to the AI)
└── wrangler.toml            Cloudflare settings (turns on the free AI)
```

## How it works

1. The visitor taps a service button or types anything.
2. **Button taps and plain details** (ZIP, phone, email) are handled instantly by the
   script, with no AI call. This saves your free AI allowance.
3. **Typed questions** go to Cloudflare's AI, which answers using your receptionist rules
   and the client's facts in `business_info`.
4. **Hard rules are enforced in code:** it always asks "Do you own this property?" first,
   a renter always ends the chat, and ZIP/phone/email are checked before they're accepted.
5. With owner + ZIP + phone + email, the lead (with the full chat) is emailed to the
   roofer and the chat ends.
6. If the AI is down or the daily free allowance is used up, the bot switches to the
   scripted flow, so no lead is lost.

---

## Step 1: Put the project on GitHub (5 minutes)

1. On GitHub, create a new **private** repository called `roof-assistant`.
2. Click **"uploading an existing file"** and drag in the **contents** of this folder
   (`public`, `functions`, `wrangler.toml`, `SETUP.md`), keeping the folders.
3. Click **Commit changes**.

## Step 2: Deploy on Cloudflare (10 minutes)

1. Create a free account at **dash.cloudflare.com**.
2. Go to **Workers & Pages → Create → Pages → Connect to Git**. Connect GitHub and pick
   the `roof-assistant` repository.
3. Build settings: Framework preset **None**, build command **empty**, build output
   directory **public**. Click **Save and Deploy**.
4. After about a minute you get an address like **`https://roof-assistant.pages.dev`**.
5. **Check the AI is connected:** your project → **Settings → Bindings**. You should see
   **Workers AI** named `AI`. If not, click **Add → Workers AI**, name it `AI`, save, then
   **Deployments → Retry deployment**.
6. **Test:** open `https://roof-assistant.pages.dev/demo.html`, click the bubble and type
   a question like "Do you help with insurance claims?"

## Step 3: Add the bot to your landing page (talentssoftware.com/roofing-assistant)

1. In GitHub, open `public/server-config.json`, click the ✏️ pencil, and in the
   `talentssoftware-demo` block replace the `email` placeholder with your email.
   Commit. Cloudflare updates automatically.
2. In your **Lovable** project, type:
   > Add this script tag to index.html just before the closing body tag. Don't change anything else.
   ```html
   <script src="https://roof-assistant.pages.dev/chat-widget.js"
           data-client-id="talentssoftware-demo" async></script>
   ```
   (Use your real Cloudflare address if it's different.)
3. Also ask Lovable:
   > Make the "Try the assistant" link and the chat preview open the live chat by calling
   > `window.RoofAssistant && window.RoofAssistant.open()` when clicked.
4. Lovable pushes to GitHub and Netlify updates your site. Open
   talentssoftware.com/roofing-assistant, chat as a homeowner, and check your inbox.
   The first time, FormSubmit sends you a confirmation email; click it once.

---

## Adding a roofing client (about 10 minutes)

1. Get: company name, city, brand colour, lead email, website domain, and a few **true**
   facts (areas served, free estimates?, insurance help?, financing?, years in business).
2. In `server-config.json`, copy the `sunshine-roofing-orlando` block, fill it in, and commit.
3. Paste the snippet on their website with their `data-client-id`:
   - WordPress: WPCode plugin → Header & Footer → Footer
   - Wix: Settings → Custom Code → Body – end
   - Shopify: `theme.liquid`, just before `</body>`
4. Do a test chat. The client clicks the one-time FormSubmit confirmation email.

**Switch a client off:** `"active": false`. **Scripted only (no AI):** `"ai_enabled": false`.

---

## Costs and limits

| Part | Cost |
|---|---|
| Hosting, widget, server function (Cloudflare Pages) | Free |
| Lead emails (FormSubmit) | Free |
| AI answers (Workers AI) | Free daily allowance (~175 AI answers/day), then about $0.0006 per answer on the Workers Paid plan ($5/month) |

- Only typed questions use AI, so a conversation costs roughly $0.002.
- The free AI allowance resets every day at 00:00 UTC. When it's used up, the bot uses the
  scripted flow until it resets, and leads still come through.
- None of this affects your talentssoftware.com website on Netlify.
- Never put API keys in `server-config.json` or the widget: those files are public.
