"""Verify deployment scoping and data protection without modifying the host."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "server.py"
spec = importlib.util.spec_from_file_location("grnscope_server_deploy", SCRIPT)
deploy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = deploy
spec.loader.exec_module(deploy)


@pytest.fixture
def installation(tmp_path):
    repo = tmp_path / 'code' / 'GRNScope'
    (repo / 'backend').mkdir(parents=True)
    (repo / 'frontend').mkdir()
    (repo / 'frontend/package.json').write_text('{}')
    (repo / 'backend/requirements.txt').write_text('fastapi\n')
    settings = {
        'DATA_ROOT': str(tmp_path / 'data' / 'grnscope'), 'DATA_MOUNT': str(tmp_path / 'data'),
        'CONDA_EXE': str(tmp_path / 'conda/bin/conda'), 'NODE_BIN': str(tmp_path / 'node/bin'),
        'SERVICE_PREFIX': 'grnscope-test', 'FRONTEND_PORT': '13000', 'BACKEND_PORT': '18000',
        'REDIS_PORT': '16379', 'WORKER_COUNT': '2', 'ALGORITHM_CPU_BUDGET': '8',
        'ALGORITHM_MEMORY_MB': '32768', 'PUBLIC_URL': 'https://grnscope.example.edu',
    }
    def load():
        path = repo / 'server.env'
        path.write_text('\n'.join(key + '=' + value for key, value in settings.items()))
        return deploy.read_config(path, repo)
    server = deploy.Server(load(), repo)
    return SimpleNamespace(repo=repo, settings=settings, load=load, server=server)


def test_defaults_and_invalid_settings(installation):
    i = installation
    assert i.server.c['BEELINE_ROOT'] == str(i.repo.parent / 'Beeline')
    i.settings['WORKER_CUONT'] = '2'
    with pytest.raises(ValueError, match='Invalid configuration key'):
        i.load()


@pytest.mark.parametrize('cpus,memory,workers,cpu_budget,memory_budget', [
    (1, 2048, 1, 1, 1024), (2, 4096, 1, 1, 2048),
    (4, 16384, 2, 1, 4096), (128, 1048576, 2, 4, 8192),
])
def test_two_setting_config_selects_bounded_resources(
        installation, cpus, memory, workers, cpu_budget, memory_budget):
    i = installation
    i.settings = {key: i.settings[key] for key in ('DATA_ROOT', 'PUBLIC_URL')}
    path = i.repo / 'minimal.env'
    path.write_text('\n'.join(key + '=' + value for key, value in i.settings.items()))
    with (patch.object(deploy, 'detect_conda', return_value='/opt/conda/bin/conda'),
          patch.object(deploy, 'detect_node', return_value='/opt/node/bin'),
          patch.object(deploy, 'host_memory_mb', return_value=memory),
          patch.object(deploy.os, 'cpu_count', return_value=cpus)):
        config = deploy.read_config(path, i.repo)
    assert config['WORKER_COUNT'] == workers
    assert config['ALGORITHM_CPU_BUDGET'] == cpu_budget
    assert config['ALGORITHM_MEMORY_MB'] == memory_budget
    assert config['FRONTEND_PORT'] == 13000
    assert config['SERVICE_PREFIX'] == 'grnscope'
    assert config['WORKER_COUNT'] * config['ALGORITHM_CPU_BUDGET'] <= cpus
    assert config['WORKER_COUNT'] * config['ALGORITHM_MEMORY_MB'] <= memory // 2


def test_home_directory_paths_expand_without_shell_evaluation(installation):
    i = installation
    i.settings['DATA_ROOT'] = '~/grnscope-data'
    i.settings['DATA_MOUNT'] = str(i.repo.parents[1])
    with patch.dict(deploy.os.environ, {'HOME': str(i.repo.parents[1])}):
        assert i.load()['DATA_ROOT'] == str(i.repo.parents[1] / 'grnscope-data')


def test_saved_defaults_survive_machine_changes_and_explicit_overrides(installation):
    i = installation
    i.server.initialize_storage()
    path = i.repo / 'minimal.env'
    path.write_text('DATA_ROOT=%s\nPUBLIC_URL=https://new.example.edu\n' % i.server.data)
    with (patch.object(deploy, 'detect_conda', side_effect=AssertionError('must keep installed path')),
          patch.object(deploy, 'detect_node', side_effect=AssertionError('must keep installed path')),
          patch.object(deploy, 'detect_mount', side_effect=AssertionError('must keep recorded mount')),
          patch.object(deploy, 'host_memory_mb', side_effect=AssertionError('must keep resource limits'))):
        config = deploy.read_config(path, i.repo)
        assert config == dict(i.server.c, PUBLIC_URL='https://new.example.edu')
        with path.open('a') as stream:
            stream.write('WORKER_COUNT=1\n')
        assert deploy.read_config(path, i.repo)['WORKER_COUNT'] == 1


def test_legacy_installation_defaults_are_reused(installation):
    i = installation
    i.server.initialize_storage()
    (i.server.settings / 'resolved-settings.json').unlink()
    (i.server.settings / 'installation.json').write_text(json.dumps(i.server.c))
    path = i.repo / 'minimal.env'
    path.write_text('DATA_ROOT=%s\nPUBLIC_URL=%s\n' % (i.server.data, i.server.c['PUBLIC_URL']))
    assert deploy.read_config(path, i.repo) == i.server.c


def test_mount_detection_walks_to_containing_mount(tmp_path):
    mount = tmp_path.resolve()
    with patch.object(deploy.os.path, 'ismount', side_effect=lambda path: Path(path) == mount):
        assert deploy.detect_mount(mount / 'not-created-yet' / 'grnscope') == str(mount)


def make_executable(path, output=''):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('#!/bin/sh\nprintf "%s\\n"\n' % output)
    path.chmod(0o755)


def test_conda_detection_finds_user_install_without_shell_activation(tmp_path):
    conda = tmp_path / 'miniconda3/bin/conda'
    make_executable(conda)
    with (patch.object(deploy.Path, 'home', return_value=tmp_path),
          patch.object(deploy.shutil, 'which', return_value=None),
          patch.dict(deploy.os.environ, {'CONDA_EXE': '/missing/conda'})):
        assert deploy.detect_conda() == str(conda)


def test_node_detection_skips_old_path_node_and_sorts_nvm_versions(tmp_path):
    old = tmp_path / 'old/bin'
    make_executable(old / 'node', 'v18.0.0')
    make_executable(old / 'npm')
    nvm = tmp_path / '.nvm'
    for version in ('v20.9.0', 'v20.18.0'):
        directory = nvm / 'versions/node' / version / 'bin'
        make_executable(directory / 'node', version)
        make_executable(directory / 'npm')
    with (patch.object(deploy.shutil, 'which', return_value=str(old / 'node')),
          patch.dict(deploy.os.environ, {'NVM_DIR': str(nvm), 'NVM_BIN': str(old)})):
        assert deploy.detect_node() == str(nvm / 'versions/node/v20.18.0/bin')


def test_missing_tools_explain_optional_overrides():
    with patch.object(deploy, 'executable', return_value=False):
        with pytest.raises(ValueError, match='CONDA_EXE='):
            deploy.detect_conda()
        with pytest.raises(ValueError, match='NODE_BIN='):
            deploy.detect_node()


@pytest.mark.parametrize('port', ['18000', '80', '70000'])
def test_port_collisions_and_privileged_ports(installation, port):
    installation.settings['FRONTEND_PORT'] = port
    with pytest.raises(ValueError, match='ports'):
        installation.load()


@pytest.mark.parametrize('key,value', [('PUBLIC_URL', 'https://example.edu/grnscope'),
                                      ('DATA_ROOT', '$HOME/data'), ('SERVICE_PREFIX', 'bad;command')])
def test_unsafe_configuration_is_rejected(installation, key, value):
    installation.settings[key] = value
    with pytest.raises(ValueError):
        installation.load()


def test_source_and_data_roots_cannot_overlap(installation):
    i = installation
    i.settings['DATA_MOUNT'] = str(i.repo.parents[1])
    i.settings['DATA_ROOT'] = str(i.repo.parent)
    with pytest.raises(ValueError, match='separate'):
        i.load()


def test_existing_project_data_is_never_replaced(installation):
    i = installation
    projects = i.repo / 'backend/projects'
    projects.mkdir()
    existing = projects / 'important.csv'
    existing.write_text('keep this dataset')
    with pytest.raises(ValueError, match='Refusing to replace'):
        i.server.initialize_storage()
    assert existing.read_text() == 'keep this dataset'
    assert not projects.is_symlink()


def test_links_are_reusable_but_foreign_links_are_rejected(installation, tmp_path):
    s = installation.server
    s.initialize_storage()
    password = (s.settings / 'redis-password').read_text()
    s.initialize_storage()
    assert (s.settings / 'redis-password').read_text() == password
    assert (s.repo / 'workspace').resolve() == s.data
    assert (s.repo / 'backend/projects').resolve() == s.data / 'projects'
    with pytest.raises(ValueError, match='points elsewhere'):
        deploy.ensure_link(s.repo / 'workspace', tmp_path)


def test_nonempty_foreign_data_directory_is_rejected(installation):
    s = installation.server
    s.data.mkdir(parents=True)
    (s.data / 'another-project').write_text('keep')
    with pytest.raises(ValueError, match='dedicated DATA_ROOT'):
        s.check_owner()
    assert (s.data / 'another-project').read_text() == 'keep'


def test_generated_units_and_environment_use_private_project_paths(installation):
    s = installation.server
    s.initialize_storage()
    s.render()
    env = (s.settings / 'runtime.env').read_text()
    assert 'GRNSCOPE_WORKER_COUNT=2\n' in env
    assert 'GRNSCOPE_ALGORITHM_MEMORY_MB=32768\n' in env
    assert 'NEXT_INTERNAL_API_PROXY_TARGET=http://127.0.0.1:18000\n' in env
    password = (s.settings / 'redis-password').read_text().strip()
    assert 'GRNSCOPE_REDIS_URL=redis://:%s@127.0.0.1:16379/0\n' % password in env
    assert (s.settings / 'runtime.env').stat().st_mode & 0o777 == 0o600
    for name, unit in zip(deploy.SERVICES, s.units()):
        text = (s.settings / 'systemd' / unit).read_text()
        assert 'User=' + s.user in text
        assert 'EnvironmentFile=' + str(s.settings / 'runtime.env') in text
        assert 'RequiresMountsFor=' + str(s.data) in text
        assert str(s.data / 'logs' / (name + '.log')) in text
        assert '0.0.0.0' not in text
    frontend = (s.settings / 'systemd' / s.units()[-1]).read_text()
    assert 'WorkingDirectory=' + str(s.frontend) in frontend
    assert '--hostname 127.0.0.1 --port 13000' in frontend
    redis = (s.settings / 'redis.conf').read_text()
    assert 'appendonly yes' in redis and 'bind 127.0.0.1' in redis
    assert 'requirepass ' + password in redis
    assert (s.settings / 'redis.conf').stat().st_mode & 0o777 == 0o600
    assert (s.settings / 'redis-password').stat().st_mode & 0o777 == 0o600
    assert 'http://127.0.0.1:13000/' in (s.settings / 'apache-proxy.conf').read_text()


@pytest.mark.parametrize('minimal', [False, True])
def test_install_and_enable_scoped_to_project(installation, minimal):
    s = installation.server
    if minimal:
        path = s.repo / 'server.env'
        path.write_text('DATA_ROOT=%s\nPUBLIC_URL=%s\n' % (s.data, s.c['PUBLIC_URL']))
        with (patch.object(deploy, 'detect_conda', return_value=s.c['CONDA_EXE']),
              patch.object(deploy, 'detect_node', return_value=s.c['NODE_BIN']),
              patch.object(deploy, 'host_memory_mb', return_value=16384),
              patch.object(deploy.os, 'cpu_count', return_value=4)):
            s = deploy.Server(deploy.read_config(path, s.repo), s.repo)
    (s.repo / 'frontend/.env.local').write_text('do not copy')
    calls = []
    def fake_run(args, **kwargs):
        args = list(map(str, args))
        calls.append(args)
        if 'create' in args:
            (s.env / 'bin').mkdir(parents=True)
            (s.env / 'bin/python').touch()
            (s.env / 'bin/redis-server').touch()
        return SimpleNamespace(stdout='test-version\n', returncode=0)
    with patch.object(s, 'check'), patch.object(s, 'run', side_effect=fake_run):
        s.install()
    assert not (s.frontend / '.env.local').exists()
    assert json.loads((s.settings / 'installation.json').read_text()) == s.c
    assert deploy.read_config(s.repo / 'server.env', s.repo) == s.c
    assert not any(cmd[0] in {'sudo', 'apt', 'apt-get'} for cmd in calls)
    assert any('redis>=7,<8' in cmd for cmd in calls)
    assert any(cmd[1:] == ['ci', '--include=dev'] for cmd in calls)
    calls.clear()
    with patch.object(s, 'check'), patch.object(s, 'verify'), patch.object(s, 'run', side_effect=fake_run):
        s.enable()
    copies = [cmd for cmd in calls if cmd[:2] == ['sudo', 'install']]
    assert len(copies) == 4
    assert {cmd[-1] for cmd in copies} == {'/etc/systemd/system/' + unit for unit in s.units()}
    assert not any('apachectl' in cmd or 'a2enmod' in cmd for cmd in calls)


def test_failed_install_invalidates_previous_completion(installation):
    s = installation.server
    s.initialize_storage()
    completed = s.settings / 'installation.json'
    completed.write_text(json.dumps(s.c))
    with patch.object(s, 'check'), patch.object(s, 'run', side_effect=subprocess.CalledProcessError(1, 'test')):
        with pytest.raises(subprocess.CalledProcessError):
            s.install()
    assert not completed.exists()


def test_enable_requires_completed_matching_configuration(installation):
    s = installation.server
    s.initialize_storage()
    s.render()
    with patch.object(s, 'check'), patch.object(s, 'run') as runner:
        with pytest.raises(ValueError, match='Finish install'):
            s.enable()
        (s.settings / 'installation.json').write_text('{}')
        with pytest.raises(ValueError, match='Finish install'):
            s.enable()
    runner.assert_not_called()


def test_foreign_service_names_are_never_reused(installation):
    s = installation.server
    result = SimpleNamespace(returncode=0, stdout='[Service]\nUser=another-project\n')
    with patch.object(deploy.subprocess, 'run', return_value=result):
        with pytest.raises(ValueError, match='another installation'):
            s.check_units()


def test_running_installation_must_be_stopped_before_rebuild(installation):
    s = installation.server
    results = [SimpleNamespace(returncode=0, stdout='# GRNScope data: ' + str(s.data)),
               SimpleNamespace(returncode=0)]
    with patch.object(deploy.subprocess, 'run', side_effect=results):
        with pytest.raises(ValueError, match='Stop GRNScope'):
            s.check_units(require_stopped=True)


def test_preflight_detects_real_port_conflict_without_running_installation(installation):
    import socket
    s = installation.server
    beeline = Path(s.c['BEELINE_ROOT'])
    (beeline / 'utils').mkdir(parents=True)
    (beeline / 'BLRunner.py').touch()
    (beeline / 'utils/initialize.sh').touch()
    binaries = [Path(s.c['CONDA_EXE']), Path(s.c['NODE_BIN']) / 'node', Path(s.c['NODE_BIN']) / 'npm']
    for binary in binaries:
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_text('#!/bin/sh\nexit 0\n')
        binary.chmod(0o755)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        s.c['FRONTEND_PORT'] = listener.getsockname()[1]
        with (patch.object(deploy.platform, 'system', return_value='Linux'),
              patch.object(deploy.platform, 'machine', return_value='x86_64'),
              patch.object(deploy.os, 'getuid', return_value=1000),
              patch.object(deploy.os.path, 'ismount', return_value=True),
              patch.object(deploy.shutil, 'which', return_value='/usr/bin/tool'),
              patch.object(s, 'check_units'),
              patch.object(s, 'run', return_value=SimpleNamespace(stdout='v20.18.0\n'))):
            with pytest.raises(ValueError, match='FRONTEND_PORT is occupied'):
                s.check()
    assert not s.data.exists()
