import { useState } from 'react';
import { api, qs } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader,
  Pagination, Select, Skeleton, Tabs, Textarea, formatDateTime, timeAgo, useFetch,
} from '../../components/ui.jsx';

const BOXES = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'sent', label: 'Sent' },
];

/**
 * Messaging between school staff, students and parents.
 * Students and parents may only write to staff — enforced by the API.
 */
export function Messages() {
  const { user, children, selectedChildId } = useAuth();
  const toast = useToast();

  const [box, setBox] = useState('inbox');
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [reading, setReading] = useState(null);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ recipient_id: '', subject: '', body: '', context_student_id: '' });
  const [sending, setSending] = useState(false);

  const { data, meta, loading, error, refetch } = useFetch(
    () => api.get(`/communication/messages${qs({ box, page, limit: 20 })}`),
    [box, page, nonce]
  );
  const { data: contacts } = useFetch(() => api.get('/communication/messages/contacts'), [composing], { skip: !composing });

  const openMessage = async (message) => {
    setReading(message);
    if (box === 'inbox' && !message.is_read) {
      try {
        await api.patch(`/communication/messages/${message.id}/read`);
        setNonce((n) => n + 1);
      } catch {
        /* reading it locally is enough */
      }
    }
  };

  const send = async (event) => {
    event.preventDefault();
    setSending(true);
    try {
      await api.post('/communication/messages', {
        recipient_id: Number(form.recipient_id),
        subject: form.subject,
        body: form.body,
        context_student_id: form.context_student_id ? Number(form.context_student_id) : null,
      });
      toast.success('Message sent');
      setComposing(false);
      setForm({ recipient_id: '', subject: '', body: '', context_student_id: '' });
      setBox('sent');
      setNonce((n) => n + 1);
    } catch (sendError) {
      toast.fromError(sendError, 'Could not send this message');
    } finally {
      setSending(false);
    }
  };

  const startReply = (message) => {
    setForm({
      recipient_id: String(message.sender_id),
      subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
      body: '',
      context_student_id: message.context_student_id ? String(message.context_student_id) : '',
    });
    setReading(null);
    setComposing(true);
  };

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle={
          user.role === 'PARENT' || user.role === 'STUDENT'
            ? 'Write to teachers, administrators and the accounts office.'
            : 'Communicate with staff, students and parents.'
        }
        actions={
          <Button
            variant="primary"
            icon="send"
            onClick={() => {
              setForm({
                recipient_id: '',
                subject: '',
                body: '',
                context_student_id: user.role === 'PARENT' && selectedChildId ? String(selectedChildId) : '',
              });
              setComposing(true);
            }}
          >
            Compose
          </Button>
        }
      />

      <Tabs
        tabs={BOXES}
        active={box}
        onChange={(next) => {
          setBox(next);
          setPage(1);
        }}
        pill
      />

      <Card bodyClass="flush" className="mt-4">
        {loading ? (
          <div style={{ padding: 16 }}>
            <Skeleton variant="row" count={6} />
          </div>
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : !data?.length ? (
          <EmptyState
            icon="mail"
            title={box === 'inbox' ? 'Your inbox is empty' : 'No sent messages'}
            message={box === 'inbox' ? 'Messages addressed to you appear here.' : 'Messages you send appear here.'}
          />
        ) : (
          <>
            <div className="feed">
              {data.map((message) => (
                <div
                  key={message.id}
                  className={`feed-item ${box === 'inbox' && !message.is_read ? 'unread' : ''}`}
                  onClick={() => openMessage(message)}
                  style={{ cursor: 'pointer' }}
                >
                  <Avatar
                    name={box === 'inbox' ? message.sender_name : message.recipient_name}
                    src={box === 'inbox' ? message.sender_photo : undefined}
                    size="sm"
                  />
                  <div className="feed-body">
                    <strong className="truncate">{message.subject}</strong>
                    <p className="truncate">{message.body}</p>
                    <span className="feed-time">
                      {box === 'inbox' ? 'From' : 'To'}{' '}
                      {box === 'inbox' ? message.sender_name : message.recipient_name}
                      <Badge tone="neutral" dot={false}>
                        {(box === 'inbox' ? message.sender_role : message.recipient_role)?.replace(/_/g, ' ')}
                      </Badge>
                      {message.context_student_name ? ` · re: ${message.context_student_name}` : ''}
                    </span>
                  </div>
                  <span className="feed-time">{timeAgo(message.created_at)}</span>
                </div>
              ))}
            </div>
            {meta && <Pagination {...meta} onChange={setPage} />}
          </>
        )}
      </Card>

      <Modal
        open={!!reading}
        onClose={() => setReading(null)}
        title={reading?.subject}
        subtitle={reading ? `${reading.sender_name} · ${formatDateTime(reading.created_at)}` : ''}
        footer={
          box === 'inbox' && reading ? (
            <>
              <Button onClick={() => setReading(null)}>Close</Button>
              <Button variant="primary" icon="send" onClick={() => startReply(reading)}>
                Reply
              </Button>
            </>
          ) : (
            <Button onClick={() => setReading(null)}>Close</Button>
          )
        }
      >
        {reading && (
          <div className="stack">
            <div className="row" style={{ gap: 12 }}>
              <Avatar name={reading.sender_name} src={reading.sender_photo} />
              <div>
                <strong>{reading.sender_name}</strong>
                <div className="text-xs text-muted">{reading.sender_role?.replace(/_/g, ' ')}</div>
              </div>
              {reading.context_student_name && (
                <Badge tone="info" dot={false}>
                  Re: {reading.context_student_name}
                </Badge>
              )}
            </div>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{reading.body}</p>
          </div>
        )}
      </Modal>

      <Modal
        open={composing}
        onClose={() => setComposing(false)}
        title="New message"
        footer={
          <>
            <Button onClick={() => setComposing(false)} disabled={sending}>
              Cancel
            </Button>
            <Button variant="primary" icon="send" onClick={send} loading={sending}>
              Send message
            </Button>
          </>
        }
      >
        <form onSubmit={send}>
          <Field label="To" required>
            <Select
              value={form.recipient_id}
              options={(contacts || []).map((contact) => ({
                value: String(contact.id),
                label: `${contact.full_name} — ${contact.role.replace(/_/g, ' ')}${contact.designation ? ` (${contact.designation})` : ''}`,
              }))}
              placeholder="Select a recipient..."
              onChange={(event) => setForm({ ...form, recipient_id: event.target.value })}
              required
            />
          </Field>

          {user.role === 'PARENT' && children.length > 0 && (
            <Field label="Regarding" hint="Attach the child this message is about">
              <Select
                value={form.context_student_id}
                options={children.map((child) => ({
                  value: String(child.id),
                  label: `${child.first_name} ${child.last_name || ''} — ${child.class_name} ${child.section_name}`,
                }))}
                placeholder="No specific child"
                onChange={(event) => setForm({ ...form, context_student_id: event.target.value })}
              />
            </Field>
          )}

          <Field label="Subject" required>
            <Input
              value={form.subject}
              onChange={(event) => setForm({ ...form, subject: event.target.value })}
              required
              maxLength={160}
            />
          </Field>
          <Field label="Message" required>
            <Textarea
              rows={6}
              value={form.body}
              onChange={(event) => setForm({ ...form, body: event.target.value })}
              required
              maxLength={4000}
            />
          </Field>
          <button type="submit" hidden />
        </form>
      </Modal>
    </>
  );
}

export default Messages;
