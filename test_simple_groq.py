import json, requests

system_prompt = """You are a booking assistant. When the user provides all details (name, email, phone, address, date, time, issue), you MUST output a conversational sentence followed by BOOKING_COMPLETE:: marker with the booking JSON. The marker must be on its own line."""

response = requests.post(
    'https://api.groq.com/openai/v1/chat/completions',
    headers={
        'Authorization': 'Bearer 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',
        'Content-Type': 'application/json'
    },
    json={
        'model': 'qwen/qwen3.6-27b',
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': 'Book me for tomorrow at 2pm. Name John Smith, email john@example.com, phone 555-123-4567, address 123 Main St. Issue: leaky faucet.'}
        ],
        'max_tokens': 1500,
        'temperature': 0.7
    }
)
print(response.status_code)
data = response.json()
content = data['choices'][0]['message']['content']
print("Content length:", len(content))
print("Has BOOKING_COMPLETE:", "BOOKING_COMPLETE" in content)
print("Content:", content[:3000])