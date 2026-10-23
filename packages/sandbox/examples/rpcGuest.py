"""Minimal Content-Length JSON-RPC interoperability example; no guest SDK needed."""
import json
import sys
import os
import threading

deadline = threading.Timer(15, lambda: os._exit(124))
deadline.daemon = True
deadline.start()


def receive():
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line == b'\r\n':
            break
        key, value = line.decode('ascii').split(':', 1)
        headers[key.lower()] = value.strip()
    length = int(headers['content-length'])
    if length < 0 or length > 65536:
        raise ValueError('Invalid frame length')
    return json.loads(sys.stdin.buffer.read(length))


def send(message):
    body = json.dumps(dict(jsonrpc='2.0', **message)).encode('utf-8')
    sys.stdout.buffer.write(('Content-Length: %d\r\n\r\n' % len(body)).encode('ascii') + body)
    sys.stdout.buffer.flush()


while True:
    request = receive()
    if request is None:
        break
    if request.get('method') != 'example.compute':
        send({'id': request.get('id'), 'error': {'code': -32601, 'message': 'Method not found'}})
        continue
    value = request['params']['value']
    if type(value) is not int:
        send({'id': request['id'], 'error': {'code': -32602, 'message': 'Expected an integer'}})
        continue
    send({'id': 'guest:1', 'method': 'example.double', 'params': {'value': value}})
    callback = receive()
    send({'id': request['id'], 'result': {'value': callback['result']['value'] + 1}})
