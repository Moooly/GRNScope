"""Exercise the real SMTP client against a loopback-only receiver."""
import asyncio
from contextlib import contextmanager
from email import policy
from email.parser import BytesParser
import socketserver
import threading
from unittest.mock import patch

from fastapi import Response
from starlette.requests import Request

from app.api import contact
from app.schemas import ContactSupportRequest

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


def test_contact_mail_work_runs_outside_the_request_event_loop():
    caller_thread = threading.get_ident()
    workers = []
    with patch.object(contact, 'send_contact_email', side_effect=lambda **kwargs: workers.append(threading.get_ident())):
        asyncio.run(contact.create_contact_request(ContactSupportRequest(question='QA'), request(), Response()))
    assert workers and workers[0] != caller_thread
