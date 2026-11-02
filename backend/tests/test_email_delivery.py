"""Exercise the real SMTP client against a loopback-only receiver."""
import asyncio
from contextlib import contextmanager
from email import policy
from email.parser import BytesParser
import json
import socketserver
import threading
from unittest.mock import patch

from fastapi import BackgroundTasks, HTTPException, Response
import pytest
from starlette.requests import Request

from app.api import contact, projects
from app.schemas import ContactSupportRequest, UpdateNotificationEmailRequest
from app.services.job_service import send_job_completion_notification_if_needed

CLIENT_ID = 'qa_email_validation_20261101'


def request():
    return Request({'type': 'http', 'method': 'POST', 'path': '/api/contact',
                    'headers': [(b'x-grnscope-client-id', CLIENT_ID.encode())]})


@contextmanager
def local_mailbox():
    messages = []

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            self.wfile.write(b'220 localhost test mail receiver\r\n')
            while line := self.rfile.readline():
                command = line.split(None, 1)[0].upper()
                if command in {b'EHLO', b'HELO', b'MAIL', b'RCPT', b'RSET'}:
                    self.wfile.write(b'250 OK\r\n')
                elif command == b'DATA':
                    self.wfile.write(b'354 End with a dot\r\n')
                    body = []
                    while (row := self.rfile.readline()) not in {b'.\r\n', b''}:
                        body.append(row[1:] if row.startswith(b'..') else row)
                    messages.append(BytesParser(policy=policy.default).parsebytes(b''.join(body)))
                    self.wfile.write(b'250 Accepted\r\n')
                elif command == b'QUIT':
                    self.wfile.write(b'221 Bye\r\n')
                    return
                else:
                    self.wfile.write(b'502 Unsupported command\r\n')

    with socketserver.ThreadingTCPServer(('127.0.0.1', 0), Handler) as server:
        server.daemon_threads = True
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        env = {
            'GRNSCOPE_SMTP_HOST': '127.0.0.1',
            'GRNSCOPE_SMTP_PORT': str(server.server_address[1]),
            'GRNSCOPE_SMTP_FROM': 'grnscope@example.invalid',
            'GRNSCOPE_SMTP_USERNAME': '', 'GRNSCOPE_SMTP_PASSWORD': '',
            'GRNSCOPE_CONTACT_EMAIL': 'support@example.invalid',
            'GRNSCOPE_SMTP_USE_TLS': 'false', 'GRNSCOPE_SMTP_USE_SSL': 'false',
            'GRNSCOPE_PUBLIC_URL': 'https://grnscope.example.invalid',
        }
        try:
            with patch.dict('os.environ', env):
                yield messages
        finally:
            server.shutdown()
            worker.join()


def test_contact_sends_to_local_smtp_and_preserves_reply_and_context():
    with local_mailbox() as messages:
        response = asyncio.run(contact.create_contact_request(
            ContactSupportRequest(question='Synthetic QA message', reply_to_email='reply@example.invalid',
                                  project_id='qa-project', algorithm_id='GENIE3'),
            request(), Response(),
        ))
    assert response.ok
    assert len(messages) == 1
    message = messages[0]
    assert message['To'] == 'support@example.invalid'
    assert message['Reply-To'] == 'reply@example.invalid'
    assert 'qa-project' in message.get_content()
    assert 'Synthetic QA message' in message.get_content()


def test_job_completion_sends_once_and_persists_delivery_state(tmp_path):
    (tmp_path / 'project.json').write_text(json.dumps({
        'project_id': 'qa-project', 'project_name': 'QA',
        'notification_email': 'results@example.invalid',
    }))
    (tmp_path / 'jobs.json').write_text(json.dumps([{
        'job_id': 'qa-job', 'overall_status': 'Completed',
        'tasks': [{'algorithm_id': 'PEARSON', 'status': 'Completed'}],
    }]))
    with local_mailbox() as messages:
        send_job_completion_notification_if_needed(tmp_path, 'qa-job')
        send_job_completion_notification_if_needed(tmp_path, 'qa-job')
    assert len(messages) == 1
    assert messages[0]['To'] == 'results@example.invalid'
    assert 'https://grnscope.example.invalid/projects/qa-project' in messages[0].get_content()
    saved = json.loads((tmp_path / 'jobs.json').read_text())[0]
    assert saved['notification_sent_at']
    assert not saved.get('notification_error')


def test_unconfigured_notifications_are_not_silently_saved(tmp_path):
    directory = tmp_path / 'qa-project'
    directory.mkdir()
    original = {'project_id': 'qa-project', 'owner_id': CLIENT_ID, 'notification_email': None}
    (directory / 'project.json').write_text(json.dumps(original))
    with patch.object(projects, 'PROJECTS_ROOT', tmp_path), patch.object(projects, 'smtp_is_configured', return_value=False):
        with pytest.raises(HTTPException) as error:
            asyncio.run(projects.update_project_notification_email(
                'qa-project', UpdateNotificationEmailRequest(notification_email='results@example.invalid'),
                BackgroundTasks(), request(), Response(),
            ))
    assert error.value.status_code == 503
    assert 'not available' in error.value.detail
    assert json.loads((directory / 'project.json').read_text()) == original


def test_contact_mail_work_runs_outside_the_request_event_loop():
    caller_thread = threading.get_ident()
    workers = []
    with patch.object(contact, 'send_contact_email', side_effect=lambda **kwargs: workers.append(threading.get_ident())):
        asyncio.run(contact.create_contact_request(ContactSupportRequest(question='QA'), request(), Response()))
    assert workers and workers[0] != caller_thread
