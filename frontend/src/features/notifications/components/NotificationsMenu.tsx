import { Box, Button, Divider, List, ListItemButton, ListItemText, Popover, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { NotificationsButton } from '@/layouts/shell/ShellControls';
import { formatDateTime } from '@/lib/dates';
import { useMarkAllRead, useMarkRead, useNotifications } from '../api/notifications';

/** Bell + popover with the latest in-app notifications (live via socket `notification:new`). */
export function NotificationsMenu() {
  const { t, i18n } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  return (
    <>
      <NotificationsButton count={unread} onClick={(e) => setAnchor(e.currentTarget)} />
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 360, maxWidth: '95vw' } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 4, py: 3 }}>
          <Typography fontWeight={700}>{t('layout.notifications')}</Typography>
          {unread > 0 && (
            <Button size="small" onClick={() => markAll.mutate()}>
              {t('notifications:markAllRead')}
            </Button>
          )}
        </Box>
        <Divider />
        {items.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 6, textAlign: 'center' }}>
            {t('layout.noNotifications')}
          </Typography>
        ) : (
          <List dense sx={{ maxHeight: 420, overflow: 'auto' }}>
            {items.map((n) => (
              <ListItemButton
                key={n.id}
                sx={{ alignItems: 'flex-start', bgcolor: n.readAt ? undefined : 'action.hover' }}
                onClick={() => {
                  if (!n.readAt) markRead.mutate(n.id);
                  setAnchor(null);
                  if (n.link) navigate(n.link);
                }}
              >
                <ListItemText
                  primary={<span dir="auto">{n.titleKey ? t(n.titleKey, n.params ?? {}) : n.title}</span>}
                  secondary={
                    <>
                      {(n.bodyKey ? t(n.bodyKey, n.params ?? {}) : n.body) && <span dir="auto">{n.bodyKey ? t(n.bodyKey, n.params ?? {}) : n.body}</span>}
                      <Typography component="span" variant="caption" display="block" color="text.secondary">
                        {formatDateTime(n.createdAt, i18n.resolvedLanguage ?? 'ar')}
                      </Typography>
                    </>
                  }
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}
