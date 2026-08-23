import json, requests

with open('/tmp/test_payload.json', 'w') as f:
    f.write(json.dumps({'messages': [
        {'role': 'user', 'content': 'Book me for tomorrow at 2pm. Name John Smith, email john@example.com, phone 555-123-4567, address 123 Main St. Issue: leaky faucet.'}
    ]}))

response = requests.post(
    'https://vernoxai.digital/api/chat',
    headers={'Content-Type': 'application/json'},
    data=open('/tmp/test_payload.json', 'rb').read()
)
data = response.json()
print(json.dumps(data, ensure_ascii=False, indent=2))