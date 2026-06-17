# GitHub Copilot vs Anthropic — Cost Comparison Calculator

A single-page web calculator for estimating and comparing the monthly cost of **GitHub Copilot** against **Anthropic Claude.ai** (seat-based plan + optional API usage).

> **⚠️ Unofficial community tool.** This was put together quickly to answer a question I got the other day about how the two products compare on cost. It is not created, endorsed, or maintained by GitHub or Anthropic. Always verify against the official [GitHub Copilot billing docs](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-copilot/about-billing-for-github-copilot) and [Anthropic pricing page](https://www.anthropic.com/pricing) before making any purchasing decisions.

---

## Purpose

The calculator is meant to give teams a rough, side-by-side monthly cost estimate when evaluating GitHub Copilot against Anthropic's Claude.ai plans. It accounts for seat costs, included AI credit pools, token-based API usage, vendor discounts, and overage — all in one place.

---

## How to use it

The calculator is a single `index.html` file with no dependencies. Just open it in a browser.

### GitHub Copilot side

1. **Licenses & Seats** — enter the number of Business seats ($19/seat) and/or Enterprise seats ($39/seat). Each tier includes a monthly AI credit pool (1,900 credits for Business, 3,900 for Enterprise).
2. **Model Usage (Token-Based)** — add one row per model your team uses. Select the provider and model, then enter estimated monthly token volumes (input, cached input, cache write, output). Hover the ⓘ icon on any model row to see its per-million-token rates.
3. **Know Your AI Credit Usage? Enter Directly** — if you have credit consumption figures from your GitHub billing dashboard, you can enter them here instead of raw token counts.
4. **Vendor Discount** — optionally apply a percentage discount to seat costs and token rates.

### Anthropic Claude.ai side

1. **Licenses & Seats** — enter the number of users and select a plan (Free / Pro at $20/user / Team at $30/user).
2. **Included Credits** — Anthropic includes API credits with paid plans but doesn't publicly disclose the amount. Enter the credits you've been told are included, either per user or as a whole-account total (toggle the checkbox). Hover the ⓘ icon for community-derived estimates by plan tier.
3. **Additional API Token Usage** — optionally add API token rows if your team also calls the Anthropic API directly. You can enter usage manually or enable **"Assume same usage as GitHub Copilot side"** to mirror the token volumes you entered on the Copilot side (mapped to equivalent Anthropic models by capability tier).
4. **Vendor Discount** — optionally apply a percentage discount to seat costs and token rates.

### Results

The **Monthly Cost Breakdown** section shows a full line-item breakdown for each side, a winner banner, and a side-by-side summary table with monthly and annual totals.

---

## Notes & limitations

- Code completions on GitHub Copilot are **unlimited** and do not consume AI credits — this calculator only covers token-based model usage and seat costs.
- The **"Assume same usage"** mirror mode on the Anthropic side maps Copilot model tiers to roughly equivalent Anthropic models. It is an illustrative estimate only — model quality, latency, context windows, and capabilities differ meaningfully.
- Promotional or trial credits (e.g., GitHub's temporary promotional credit boost through August 2026) are **not** included in calculations.
- Anthropic's included credit amounts are not publicly disclosed. Community-derived estimates are provided via the ⓘ tooltip for reference only and are not confirmed by Anthropic.

---

## Disclaimer

This tool is provided for **informational purposes only** and reflects a point-in-time snapshot of publicly available pricing. It is an independent community project and is **not affiliated with, endorsed by, or maintained by GitHub or Anthropic**. Pricing, plan features, and credit allocations are subject to change without notice.
