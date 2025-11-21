#!/bin/bash

# Test script for m3u8 HLS stream transcription
# Replace with your actual m3u8 URL

M3U8_URL="https://example.com/stream.m3u8"
ENDPOINT="${ENDPOINT:-http://localhost:3000}"

echo "🧪 Testing m3u8 HLS transcription"
echo "📺 Stream URL: $M3U8_URL"
echo "🎯 Endpoint: $ENDPOINT"
echo ""

# Post the job
echo "📤 Submitting transcription job..."
RESPONSE=$(curl -s -X POST "$ENDPOINT/WHSPR/post_service" \
  -H "Content-Type: application/json" \
  -d "{\"remote_url\": \"$M3U8_URL\"}")

echo "Response: $RESPONSE"
echo ""

# Extract payment hash
PAYMENT_HASH=$(echo $RESPONSE | grep -o '"paymentHash":"[^"]*"' | cut -d'"' -f4)

if [ -z "$PAYMENT_HASH" ]; then
  echo "❌ Failed to get payment hash"
  exit 1
fi

echo "✅ Job submitted with payment hash: $PAYMENT_HASH"
echo ""
echo "🔍 Polling for result..."

# Poll for result
for i in {1..30}; do
  echo "Attempt $i/30..."
  RESULT=$(curl -s "$ENDPOINT/WHSPR/$PAYMENT_HASH/get_result")
  
  STATE=$(echo $RESULT | grep -o '"state":"[^"]*"' | cut -d'"' -f4)
  
  if [ "$STATE" == "DONE" ]; then
    echo "✅ Transcription complete!"
    echo "$RESULT" | jq '.' 2>/dev/null || echo "$RESULT"
    exit 0
  elif [ "$STATE" == "ERROR" ]; then
    echo "❌ Transcription failed"
    echo "$RESULT" | jq '.' 2>/dev/null || echo "$RESULT"
    exit 1
  else
    echo "Status: $STATE"
    sleep 2
  fi
done

echo "⏱️  Timeout waiting for transcription"
exit 1

