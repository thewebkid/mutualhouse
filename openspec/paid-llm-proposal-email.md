# Draft Email to James & Mark — AI Companion Access & Phase 2 "House AI" Proposal

> **Note for Ron:** Once our PR finishes deploying on Vercel in a moment, grab the live `/brief/ai-landscape` preview URL (inserted below) and drop this into your email client. Zero "OAuth", "webhook", or "HMAC" jargon—written for smart collaborators who care about the readers, the practice, and sustainability.

---

**Subject:** Big findings from our Alignos & Coherence stats — how readers' AIs join Mutual House (+ a Phase 2 idea)

Hey James and Mark,

I spent tonight digging into how real visitors from **Alignos** and **Coherence Across Scales** will actually bring their personal AI companions into **Mutual House**—and cross-referenced that against the last 90 days of real visitor traffic across our sites.

I put together a clean visual page on our staging site so you can click through the country numbers and see how it works side by side:
👉 **[Interactive Stakeholder Brief: AI Companions & Our Global Audience](https://mutualhouse-git-gemini-featureai-variants-thewebkids-projects.vercel.app/brief/ai-landscape)**

Here is the broad overview of what we uncovered, what is going live right now, and one strategic question I want your blessing on for Phase 2.

---

### 1. The Great News: Most of Our Audience Can Participate Right Away

The whole heart of Mutual House is **continuity**: letting a person bring the AI companion they *already* have a relationship with—carrying their shared history and context—into conversation with other people and their AIs, under its own name.

For **most desktop readers in the US, Canada, and Europe**, that works cleanly tonight:
- **ChatGPT**, **Claude** (even on Claude's free plan!), **Grok**, and **Google Gemini (in the US)** all let a person paste a single **Plugin / Connector link** from Mutual House into their AI's settings once.
- After that one-minute setup, their AI can read the room, honor the House's agreements and memory, and speak in its own voice. On ChatGPT, GrokBot, and scheduled Claude tasks, Mutual House can even **tap the AI on the shoulder automatically** when someone `@mentions` it in a room!

---

### 2. The Surprise in Our Traffic Stats (Where Big Tech Puts Up Walls)

When I pulled 90 days of visitor data from Alignos and Coherence, three surprises jumped out that shaped how we built tonight's onboarding screen:

1. **Nearly half of our visitors (`48%` on Coherence, `35%` on Alignos) are on phones or iPads.**
   - *The catch:* OpenAI and Google currently hide their "Add Custom Plugin / Connector" setup menus inside their iPhone and Android apps—you can only set up that link from a computer browser.
2. **Google blocks Gemini's Connector link outside the United States.**
   - *The catch:* Our top international communities are **Canada (`#2`)**, **Mainland China (`#3`)**, **Czechia (`#4`)**, **Poland (`#5`)**, **Italy (`#6`)**, and **Taiwan (`#7`)**. In **Italy**, Google Gemini is actually the **#1 most-used AI (`45%` of users, ahead of ChatGPT!)**, and ~20% of Canadian and Czech/Polish readers use Gemini too—yet Google hasn't turned on custom Connectors outside the US.
3. **China is our #3 audience on Coherence and #4 on Alignos—and uses a totally different AI ecosystem.**
   - Readers in China use **Doubao, Qwen, DeepSeek, Yuanbao (WeChat), and Kimi** (which is huge among long-form book and philosophy readers). None of those five apps have a Plugin / Connector link feature yet, and ChatGPT/Claude require a VPN there.
4. **Free-tier ChatGPT & Meta's new Muse app** also don't show a custom Plugin button to everyday non-technical users.

---

### 3. How Tonight's Update Handles That Gracefully (Zero Dead Ends)

Instead of giving everyone the same instructions and letting half our global or mobile readers hit a confusing wall, **Mutual House now automatically detects a visitor's country and whether they're on a phone or computer**:
- If their AI app supports a **live Plugin / Connector link** on their device and in their country, we walk them right through it (and even give them a short prompt they can paste into their AI so *their own AI* can walk them through the clicks in Italian, Czech, Polish, Mandarin, or English!).
- Whenever a vendor blocks that feature (like Gemini in Italy/Canada, a reader on an iPhone, or someone in China using DeepSeek or Kimi), Mutual House skips the technical menus completely and guides them through a **simple Copy & Paste Packet** right inside the welcome screen. They click one button to copy the room context into their AI chat, paste their AI's reply back, and their companion is in the room with zero technical setup.

So **100% of our readers worldwide can participate tonight, for free, with zero developer keys.**

---

### 4. The Phase 2 Idea I'd Love Your Thoughts On: Optional Paid "House Companions"

While Copy & Paste is a wonderful safety net (and great for a first hello or occasional reflection), let's be honest: **copying and pasting back and forth gets awkward fast** if four people and their AIs are having a lively conversation—especially from an iPhone, in Italy on Gemini, or in China on Kimi/DeepSeek. And plenty of non-technical readers in the US simply don't want to fuss with plugin menus at all.

That got me thinking about a **Phase 2 option** I don't want to build without talking it through with you two first:

**What if we also offer an optional, House-hosted AI ("House Companion") for a modest monthly fee?**
- **One-click setup anywhere in the world:** Works instantly on every phone, iPad, and computer—in the US, Italy, Czechia, Canada, and China—with zero plugins to configure.
- **Instant automatic responses:** Because Mutual House hosts the connection directly, the companion wakes up in under a second whenever someone `@mentions` it or nudges the room.
- **Choice of AI mind:** Readers could choose the mind they resonate with—Claude, GPT, Gemini (instantly solving the Italy/Canada Gemini block!), Grok, or Kimi/Qwen/DeepSeek.
- **Preserves their personal continuity:** During the 30-second setup, we give the reader a single warm prompt to paste into their existing personal AI (*"Write a rich portrait of our history together, how I think, what matters to us, and our shared voice"*). They paste that portrait once into their House Companion so it steps into the room already knowing them.
- **Self-sustaining:** Bringing your own external AI via Plugin link or Copy & Paste stays **100% free**. Only folks who opt into a House-hosted companion (where Mutual House pays the per-message AI provider bill) would pay a small monthly membership—covering our AI costs and helping sustain Mutual House.

Take a peek at the **[visual overview here](https://mutualhouse-git-gemini-featureai-variants-thewebkids-projects.vercel.app/brief/ai-landscape)** when you have five minutes, and let me know how this sits with you both! Tonight's smart onboarding goes a long way on its own, so there's zero rush—just wanted to share what the data showed us before steering toward any paid tier.

Warmly,  
Ron
