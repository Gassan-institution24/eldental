import { Box, FormControlLabel, IconButton, Stack, Switch, Tooltip } from '@mui/material';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from './ConfirmDialog';
import { useNotify } from '../hooks/useNotify';

/** A small colour dot (calendar colour, category colour). */
export function ColorDot({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: color,
        flexShrink: 0,
      }}
    />
  );
}

type RowActionsProps = {
  onEdit?: () => void;
  onDelete?: () => Promise<void>;
  onUndo?: () => Promise<unknown>;
  name: string;
  deleteTitle: string;
  deleteBody?: string;
  deletedMessage: string;
};

/** Edit / delete buttons for a table row, with confirmation naming the object and undo (16 §4). */
export function RowActions({
  onEdit,
  onDelete,
  onUndo,
  deleteTitle,
  deleteBody,
  deletedMessage,
}: RowActionsProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const notify = useNotify();
  return (
    <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
      {onEdit && (
        <Tooltip title={t('actions.edit')}>
          <IconButton size="small" onClick={onEdit} aria-label={t('actions.edit')}>
            <Pencil size={16} />
          </IconButton>
        </Tooltip>
      )}
      {onDelete && (
        <Tooltip title={t('actions.delete')}>
          <IconButton
            size="small"
            color="error"
            aria-label={t('actions.delete')}
            onClick={async () => {
              const r = await confirm({
                title: deleteTitle,
                body: deleteBody ?? t('confirm.deleteBody'),
                confirmLabel: t('actions.delete'),
                destructive: true,
              });
              if (!r.confirmed) return;
              try {
                await onDelete();
                notify.success(deletedMessage, onUndo ? { undo: () => void onUndo() } : {});
              } catch (err) {
                notify.error(err);
              }
            }}
          >
            <Trash2 size={16} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}

export function InactiveToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <FormControlLabel
      control={
        <Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      }
      label={label}
      sx={{ m: 0 }}
    />
  );
}
