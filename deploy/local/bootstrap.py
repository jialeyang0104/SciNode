#!/usr/bin/env python3
"""Provision isolated local storage and launchd definitions for SciNode."""
import json
import os
from pathlib import Path
import plistlib
import secrets
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / 'deploy/local'
MYSQL = Path('/opt/homebrew/opt/mysql@8.4/bin')


def private_file(path, content):
    path.write_text(content)
    path.chmod(0o600)


def main():
    LOCAL.mkdir(parents=True, exist_ok=True)
    LOCAL.chmod(0o700)
    for folder in ['data/mysql', 'data/redis', 'logs', 'run']:
        (LOCAL / folder).mkdir(parents=True, exist_ok=True)
    secret_file = LOCAL / 'secrets.json'
    if secret_file.exists():
        credentials = json.loads(secret_file.read_text())
    else:
        credentials = {key: secrets.token_hex(24) for key in
                       ['root_password', 'db_password', 'redis_password', 'jwt_secret', 'admin_password']}
        private_file(secret_file, json.dumps(credentials))
    relocation_file = LOCAL / 'path-relocation.json'
    relocation = json.loads(relocation_file.read_text()) if relocation_file.exists() else {}
    relocation_env = [f'scinode.{key}={value}' for key, value in relocation.items()]
    private_file(ROOT / 'backend/.env', '\n'.join([
        'SERVER_PORT=8084', 'server.address=127.0.0.1',
        'server.max-http-request-header-size=256KB',
        'MYSQL_HOST=127.0.0.1', 'MYSQL_PORT=3307', 'MYSQL_DATABASE=scinode',
        'MYSQL_USERNAME=scinode', f'MYSQL_PASSWORD={credentials["db_password"]}',
        'spring.datasource.url=jdbc:mysql://127.0.0.1:3307/scinode?useUnicode=true&characterEncoding=utf-8&useSSL=false&serverTimezone=Asia/Shanghai&serverRSAPublicKeyFile=' + str(LOCAL / 'data/mysql/public_key.pem'),
        'REDIS_HOST=127.0.0.1', 'REDIS_PORT=6380',
        f'REDIS_PASSWORD={credentials["redis_password"]}',
        f'JWT_SECRET={credentials["jwt_secret"]}', f'APP_AUTH_DEFAULT_USERNAME={credentials.get("admin_username", "admin")}',
        f'APP_AUTH_DEFAULT_PASSWORD={credentials["admin_password"]}',
        'scinode.python=/opt/homebrew/anaconda3/bin/python3',
        'scinode.rscript=/usr/local/bin/Rscript',
        'scinode.document-python=/Users/yangjiale/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
        'scinode.data-dir=' + str(ROOT / 'backend/scinode-data'),
        'spring.devtools.restart.enabled=false', 'spring.devtools.livereload.enabled=false',
        'mybatis-plus.configuration.log-impl=org.apache.ibatis.logging.nologging.NoLoggingImpl',
    ] + relocation_env) + '\n')
    private_file(ROOT / 'frontend/.env.local',
                 'VITE_API_BASE_URL=/api\nVITE_API_PROXY_TARGET=http://127.0.0.1:8084\n')
    private_file(LOCAL / 'mysql.cnf', f'''[mysqld]
basedir=/opt/homebrew/opt/mysql@8.4
datadir={LOCAL / 'data/mysql'}
socket={LOCAL / 'run/mysql.sock'}
pid-file={LOCAL / 'run/mysql.pid'}
port=3307
bind-address=127.0.0.1
mysqlx=0
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
log-error={LOCAL / 'logs/mysql-error.log'}
innodb-buffer-pool-size=128M
''')
    private_file(LOCAL / 'mysql-client.cnf', f'''[client]
user=root
password={credentials['root_password']}
socket={LOCAL / 'run/mysql.sock'}
''')
    private_file(LOCAL / 'redis.conf', f'''bind 127.0.0.1
protected-mode yes
port 6380
requirepass {credentials['redis_password']}
dir {LOCAL / 'data/redis'}
appendonly yes
daemonize no
''')
    marker = LOCAL / 'database-initialized'
    if not marker.exists():
        if any((LOCAL / 'data/mysql').iterdir()):
            raise RuntimeError('Existing unmarked MySQL directory; inspect before initialization')
        subprocess.run([str(MYSQL / 'mysqld'), f'--defaults-file={LOCAL / "mysql.cnf"}',
                        '--initialize-insecure'], check=True)
        with (LOCAL / 'logs/mysql-bootstrap.log').open('a') as logfile:
            process = subprocess.Popen([str(MYSQL / 'mysqld'),
                                        f'--defaults-file={LOCAL / "mysql.cnf"}', '--skip-networking'],
                                       stdout=logfile, stderr=logfile)
            try:
                for _ in range(45):
                    if process.poll() is not None:
                        raise RuntimeError('MySQL initialization process exited')
                    check = subprocess.run([str(MYSQL / 'mysqladmin'), '--no-defaults', '-u', 'root',
                                            f'--socket={LOCAL / "run/mysql.sock"}', 'ping'],
                                           capture_output=True)
                    if check.returncode == 0:
                        break
                    time.sleep(1)
                else:
                    raise RuntimeError('MySQL initialization readiness timeout')
                sql = (ROOT / 'backend/src/main/resources/schema.sql').read_text()
                sql += f"\nCREATE USER 'scinode'@'127.0.0.1' IDENTIFIED BY '{credentials['db_password']}';\n"
                sql += "GRANT ALL PRIVILEGES ON scinode.* TO 'scinode'@'127.0.0.1';\n"
                sql += f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{credentials['root_password']}';\n"
                subprocess.run([str(MYSQL / 'mysql'), '--no-defaults', '-u', 'root',
                                f'--socket={LOCAL / "run/mysql.sock"}', '--default-character-set=utf8mb4'],
                               input=sql, text=True, check=True)
                subprocess.run([str(MYSQL / 'mysqladmin'),
                                f'--defaults-extra-file={LOCAL / "mysql-client.cnf"}', 'shutdown'], check=True)
                process.wait(timeout=30)
                marker.write_text('schema initialized with isolated database and restricted application user\n')
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=30)
    definitions = {
        'mysql': (LOCAL, [str(MYSQL / 'mysqld'), f'--defaults-file={LOCAL / "mysql.cnf"}']),
        'redis': (LOCAL, ['/opt/homebrew/opt/redis/bin/redis-server', str(LOCAL / 'redis.conf')]),
        'backend': (ROOT / 'backend', ['/opt/homebrew/opt/openjdk@21/bin/java', '-Xms128m', '-Xmx768m',
                                     '-jar', str(ROOT / 'backend/target/scinode-backend-1.0.0.jar')]),
        'web': (ROOT / 'frontend', ['/opt/homebrew/bin/node', '--max-http-header-size=262144',
                                 str(ROOT / 'frontend/node_modules/vite/bin/vite.js'), 'preview',
                                 '--host', '127.0.0.1', '--port', '5173', '--strictPort']),
    }
    agents = Path.home() / 'Library/LaunchAgents'
    agents.mkdir(parents=True, exist_ok=True)
    for name, (cwd, arguments) in definitions.items():
        path = agents / f'com.local.scinode.{name}.plist'
        if path.exists():
            existing = plistlib.loads(path.read_bytes())
            if existing.get('WorkingDirectory') != str(cwd):
                raise RuntimeError(f'Conflicting launch agent: {path}')
        definition = dict(Label=f'com.local.scinode.{name}', ProgramArguments=arguments,
                          WorkingDirectory=str(cwd), RunAtLoad=True, KeepAlive=True, ThrottleInterval=10,
                          StandardOutPath=str(LOCAL / f'logs/{name}.log'),
                          StandardErrorPath=str(LOCAL / f'logs/{name}-stderr.log'),
                          EnvironmentVariables={'PATH': '/opt/homebrew/bin:/usr/bin:/bin',
                                                'JAVA_HOME': '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'})
        path.write_bytes(plistlib.dumps(definition))
        path.chmod(0o600)
    private_file(LOCAL / '登录信息.txt',
                 f'SciNode 本地地址：http://127.0.0.1:5173/\n用户名：{credentials.get("admin_username", "admin")}\n密码：{credentials["admin_password"]}\n')
    print('Local database, credentials, and 4 launch agents provisioned; secrets saved privately.')


if __name__ == '__main__':
    main()
