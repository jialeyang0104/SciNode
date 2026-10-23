#!/usr/bin/env python3
"""Start and stop only this SciNode deployment's launchd services."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / 'deploy/local'
DOMAIN = f'gui/{os.getuid()}'
SERVICES = ['mysql', 'redis', 'backend', 'web']
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def loaded(name):
    return subprocess.run(['launchctl', 'print', f'{DOMAIN}/com.local.scinode.{name}'],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def ready(name):
    if name == 'mysql':
        command = ['/opt/homebrew/opt/mysql@8.4/bin/mysqladmin',
                   f'--defaults-extra-file={LOCAL / "mysql-client.cnf"}', 'ping']
    elif name == 'redis':
        command = ['/opt/homebrew/opt/redis/bin/redis-cli', '-p', '6380', 'PING']
    else:
        try:
            if name == 'backend':
                credentials = json.loads((LOCAL / 'secrets.json').read_text())
                payload = json.dumps({'username': credentials.get('admin_username', 'admin'), 'password': credentials['admin_password']}).encode()
                request = urllib.request.Request('http://127.0.0.1:8084/api/auth/login', data=payload,
                                                 headers={'Content-Type': 'application/json'})
                with OPENER.open(request, timeout=3) as response:
                    login = json.load(response)
                if login.get('code') != 200:
                    return False
                tokens = login['data']
                token = tokens.get('token') or tokens.get('accessToken')
                request = urllib.request.Request('http://127.0.0.1:8084/api/research/projects',
                                                 headers={'Authorization': f'Bearer {token}'})
                with OPENER.open(request, timeout=3) as response:
                    workflows = json.load(response)
                logout = urllib.request.Request('http://127.0.0.1:8084/api/auth/logout',
                                                data=json.dumps({'refreshToken': tokens['refreshToken']}).encode(),
                                                headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})
                with OPENER.open(logout, timeout=3) as response:
                    result = json.load(response)
                return workflows.get('code') == 200 and result.get('code') == 200
            with OPENER.open('http://127.0.0.1:5173/', timeout=3) as response:
                return response.status == 200
        except (OSError, urllib.error.URLError):
            return False
    env = os.environ.copy()
    if name == 'redis':
        env['REDISCLI_AUTH'] = json.loads((LOCAL / 'secrets.json').read_text())['redis_password']
    result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=4)
    return result.returncode == 0 and ('alive' in result.stdout or 'PONG' in result.stdout)


def start():
    for name in SERVICES:
        if not loaded(name):
            path = Path.home() / 'Library/LaunchAgents' / f'com.local.scinode.{name}.plist'
            subprocess.run(['launchctl', 'bootstrap', DOMAIN, str(path)], check=True)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if not loaded(name):
                path = Path.home() / 'Library/LaunchAgents' / f'com.local.scinode.{name}.plist'
                subprocess.run(['launchctl', 'bootstrap', DOMAIN, str(path)], check=True)
            if ready(name):
                print(f'{name}: ready', flush=True)
                break
            time.sleep(1)
        else:
            raise RuntimeError(f'{name} readiness failed; inspect {LOCAL / "logs"}')
    print('SciNode: http://127.0.0.1:5173/', flush=True)


def stop():
    for name in reversed(SERVICES):
        if loaded(name):
            subprocess.run(['launchctl', 'bootout', f'{DOMAIN}/com.local.scinode.{name}'], check=True)
            port = {'mysql': 3307, 'redis': 6380, 'backend': 8084, 'web': 5173}[name]
            deadline = time.monotonic() + 30
            while subprocess.run(['/usr/sbin/lsof', '-ti', f'TCP:{port}', '-sTCP:LISTEN'], capture_output=True).stdout.strip():
                if time.monotonic() >= deadline:
                    raise RuntimeError(f'{name} shutdown timed out on port {port}')
                time.sleep(0.2)
            print(f'{name}: stopped', flush=True)


if __name__ == '__main__':
    action = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if action == 'start':
        start()
    elif action == 'stop':
        stop()
    elif action == 'status':
        for service in SERVICES:
            print(f'{service}: {"ready" if loaded(service) and ready(service) else "stopped or unhealthy"}')
    else:
        raise SystemExit('Usage: manage.py start|stop|status')
