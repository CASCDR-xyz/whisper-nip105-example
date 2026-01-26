# LUD-12 Invoice Comments Implementation

## Overview

This document describes how Lightning invoice comments are implemented in the Whispr transcription service using the **LUD-12** (LNURL Comments) specification.

## What is LUD-12?

LUD-12 is an extension to the LNURL-pay protocol (LUD-06) that allows payers to attach a text comment to their payment request. The comment is embedded in the Lightning invoice's description field.

**Specification:** https://github.com/lnurl/luds/blob/luds/12.md

## How It Works

### 1. LNURL Resolution

When generating an invoice, we first resolve the Lightning Address to get the LNURL metadata:

```
GET https://{domain}/.well-known/lnurlp/{username}
```

The response includes a `commentAllowed` field indicating the maximum comment length:

```json
{
  "callback": "https://getalby.com/lnurlp/cascdr/callback",
  "minSendable": 1000,
  "maxSendable": 10000000000,
  "commentAllowed": 255,  // <-- max chars allowed (0 = not supported)
  "metadata": "..."
}
```

### 2. Invoice Request with Comment

If `commentAllowed > 0`, we append a URL-encoded `comment` parameter to the callback:

```
GET {callback}?amount={msats}&expiry={timestamp}&comment={url_encoded_comment}
```

### 3. Comment Format

Our implementation uses the following format:

```
{SERVICE} requested at {ISO_TIMESTAMP} via {ORIGIN_URL}
```

**Example:**
```
WHSPR requested at 2026-01-26T18:30:00.000Z via https://whispr.cascdr.xyz
```

This provides:
- **Service identification** - Which service was requested
- **Timestamp** - When the request was made (UTC)
- **Origin** - The endpoint that generated the invoice

## Implementation Details

### Location

`lib/nip105.js` → `generateInvoice()`

### Code Flow

```javascript
// 1. Check if comments are supported
const commentAllowed = lnAddress.commentAllowed || 0;

if (commentAllowed > 0) {
  // 2. Build the comment
  const timestamp = new Date().toISOString();
  const originUrl = process.env.ENDPOINT || 'https://whispr.cascdr.xyz';
  const comment = `${service} requested at ${timestamp} via ${originUrl}`;
  
  // 3. Truncate if needed & URL encode
  const truncatedComment = comment.substring(0, commentAllowed);
  const encodedComment = encodeURIComponent(truncatedComment);
  
  // 4. Append to callback URL
  url += `&comment=${encodedComment}`;
}
```

### Graceful Degradation

- If `commentAllowed` is `0`, `null`, or missing, no comment is sent
- If the comment exceeds the allowed length, it's truncated
- The invoice generation works regardless of comment support

## Benefits

1. **Audit Trail** - Wallet providers (like Alby) can display the comment, helping users identify payments
2. **Debugging** - Timestamps help correlate invoices with specific requests
3. **Transparency** - Users see exactly what service they're paying for

## Testing

Verified working with Alby (`cascdr@getalby.com`) which supports `commentAllowed: 255`:

```bash
# Test command
curl -s "https://getalby.com/lnurlp/cascdr/callback?amount=1000&comment=WHSPR%20requested%20at%202026-01-26T18%3A30%3A00Z%20via%20https%3A%2F%2Fwhispr.cascdr.xyz"

# Response includes the invoice with embedded comment
{"status":"OK","pr":"lnbc10n1p5...","verify":"https://getalby.com/lnurlp/cascdr/verify/..."}
```

## Related Specifications

- **LUD-06** (LNURL-pay): Base payment protocol
- **LUD-12** (Comments): Comment extension
- **BOLT-11**: Lightning invoice format (description field)
- **NIP-105**: Nostr service payments (this service's protocol)

## Environment Variables

| Variable | Usage |
|----------|-------|
| `LN_ADDRESS` | Lightning address for receiving payments |
| `ENDPOINT` | Used as the origin URL in comments |
