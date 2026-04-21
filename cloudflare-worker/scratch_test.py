import urllib.request, json, urllib.error
req = urllib.request.Request(
    'https://ai-srf-worker.bryte-sika.workers.dev/', 
    method='POST', 
    data=json.dumps({'system':'Test','messages':[{'role':'user','content':'test'}],'stream':True,'orgId':'test','sessionId':'test','stage':1}).encode('utf-8'), 
    headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'}
)
try:
    res = urllib.request.urlopen(req)
    print(res.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print('Status:', e.code)
    print('Body:', e.read().decode('utf-8'))
