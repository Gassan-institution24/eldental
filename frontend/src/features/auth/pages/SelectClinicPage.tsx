import {
  Avatar,
  Box,
  Chip,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useNotify } from '@/shared/hooks/useNotify';
import { PageSkeleton } from '@/shared/components/States';
import { selectClinic } from '../api/authApi';
import { useSession } from '../api/session';

export function SelectClinicPage() {
  const { t } = useTranslation('auth');
  const { data, isLoading } = useSession();
  const navigate = useNavigate();
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading || !data) return <PageSkeleton rows={3} />;

  const open = async (id: string) => {
    setBusy(id);
    try {
      await selectClinic(id);
      navigate('/clinic/dashboard', { replace: true });
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box>
      <Typography variant="h2" component="h1">
        {t('selectClinic.title')}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 4 }}>
        {t('selectClinic.subtitle')}
      </Typography>
      <List>
        {data.clinics.map((c) => (
          <ListItemButton
            key={c.id}
            onClick={() => void open(c.id)}
            disabled={busy !== null}
            selected={data.clinic?.id === c.id}
            sx={{ borderRadius: 2, mb: 2, border: 1, borderColor: 'divider' }}
          >
            <ListItemAvatar>
              <Avatar sx={{ bgcolor: 'primary.main' }}>
                <Building2 size={18} />
              </Avatar>
            </ListItemAvatar>
            <ListItemText primary={<span dir="auto">{c.name}</span>} secondary={c.slug} />
            {c.isOwner && <Chip size="small" label={t('selectClinic.owner')} />}
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}
