import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  Grid,
  IconButton,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  CalendarCheck,
  CalendarX,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Stethoscope,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { dayjs, formatDate, formatTime, todayLocal } from '@/lib/dates';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { useNotify } from '@/shared/hooks/useNotify';
import {
  useBookOnline,
  useClinicPage,
  useOnlineClinics,
  useOnlineSlots,
  usePortalMe,
  type PortalAppointment,
} from '../api';
import { PortalHeader, useSeedLabel } from '../components';
import { patientCta } from './PatientAuthPages';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card sx={{ p: { xs: 4, md: 5 }, mb: 4 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 4 }}>
        <Avatar sx={{ width: 28, height: 28, fontSize: 14, bgcolor: 'primary.main' }}>{n}</Avatar>
        <Typography variant="h5" component="h2">
          {title}
        </Typography>
      </Stack>
      {children}
    </Card>
  );
}

/** Selectable card used for services, dentists and family members. */
function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Card
      variant="outlined"
      sx={(th) => ({
        height: '100%',
        borderWidth: 2,
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? alpha(th.palette.primary.main, 0.06) : 'background.paper',
      })}
    >
      <CardActionArea
        onClick={onClick}
        aria-pressed={selected}
        sx={{ p: 3, height: '100%', display: 'flex', justifyContent: 'flex-start', gap: 2 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
        {selected && <Check size={18} />}
      </CardActionArea>
    </Card>
  );
}

function Done({ appt, onAgain }: { appt: PortalAppointment; onAgain: () => void }) {
  const { t, i18n } = useTranslation('patient');
  const label = useSeedLabel('appointmentType');
  return (
    <Card sx={{ p: { xs: 6, md: 10 }, textAlign: 'center' }}>
      <Box
        sx={(th) => ({
          width: 72,
          height: 72,
          mx: 'auto',
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          color: 'success.main',
          bgcolor: alpha(th.palette.success.main, 0.12),
        })}
      >
        <CalendarCheck size={34} />
      </Box>
      <Typography variant="h3" component="h1" sx={{ mt: 4 }}>
        {t('portal.book.done')}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 2 }}>
        {t('portal.book.doneBody', {
          date: formatDate(appt.start, i18n.language, 'dddd LL'),
          time: formatTime(appt.start, i18n.language),
          dentist: appt.dentist.name,
        })}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {[label(appt.appointmentType), appt.clinic?.name, appt.number].filter(Boolean).join(' · ')}
      </Typography>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        justifyContent="center"
        sx={{ mt: 6 }}
      >
        <Button
          component={RouterLink}
          to="/portal/appointments"
          variant="contained"
          sx={patientCta}
        >
          {t('portal.book.viewAppointments')}
        </Button>
        <Button variant="outlined" onClick={onAgain}>
          {t('portal.book.bookAnother')}
        </Button>
      </Stack>
    </Card>
  );
}

/** Online booking (01 §4.10): clinic → who → service → dentist → day & time → confirm. */
export function BookPage() {
  const { t, i18n } = useTranslation('patient');
  const lang = i18n.language;
  const notify = useNotify();
  const [params] = useSearchParams();
  const me = usePortalMe();
  const clinics = useOnlineClinics();
  const typeLabel = useSeedLabel('appointmentType');

  const [slug, setSlug] = useState(params.get('clinic') ?? '');
  const [who, setWho] = useState('');
  const [typeId, setTypeId] = useState('');
  const [dentistId, setDentistId] = useState('');
  const [weekStart, setWeekStart] = useState(todayLocal());
  const [day, setDay] = useState('');
  const [slot, setSlot] = useState<{ start: string; dentistId: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState<PortalAppointment | null>(null);

  // Default clinic: one the patient already has a file at, else the first online clinic.
  useEffect(() => {
    if (slug || !clinics.data) return;
    const mineOnline = me.data?.clinics.find((c) => c.onlineBooking)?.slug;
    setSlug(mineOnline ?? clinics.data[0]?.slug ?? '');
  }, [slug, clinics.data, me.data]);

  const page = useClinicPage(slug || undefined);
  const files = useMemo(
    () => (me.data?.patients ?? []).filter((p) => p.clinic?.slug === slug),
    [me.data, slug],
  );
  useEffect(() => {
    setWho(files.find((f) => f.relation === 'self')?.id ?? files[0]?.id ?? '');
  }, [files]);
  useEffect(() => {
    setTypeId(page.data?.appointmentTypes[0]?.id ?? '');
    setDentistId('');
  }, [page.data]);

  const from = weekStart;
  const to = dayjs(weekStart).add(6, 'day').format('YYYY-MM-DD');
  const slots = useOnlineSlots(slug || undefined, {
    appointmentTypeId: typeId || undefined,
    dentistId: dentistId || undefined,
    from,
    to,
  });
  const days = slots.data?.days ?? [];
  useEffect(() => {
    setSlot(null);
    setDay(days.find((d) => d.slots.length)?.date ?? days[0]?.date ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots.data]);

  const book = useBookOnline();
  const dentistName = (id: string) => page.data?.dentists.find((d) => d.id === id)?.name ?? '';
  const type = page.data?.appointmentTypes.find((x) => x.id === typeId);
  const daySlots = days.find((d) => d.date === day)?.slots ?? [];
  const canPrevWeek = weekStart > todayLocal();

  const confirm = async () => {
    if (!slot || !type) return;
    try {
      const appt = await book.mutateAsync({
        clinicSlug: slug,
        ...(who ? { patientId: who } : {}),
        appointmentTypeId: type.id,
        dentistId: slot.dentistId,
        start: slot.start,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setDone(appt);
    } catch (err) {
      notify.error(err);
      setSlot(null);
      void slots.refetch();
    }
  };

  if (done) {
    return (
      <Done
        appt={done}
        onAgain={() => {
          setDone(null);
          setSlot(null);
          setNotes('');
        }}
      />
    );
  }
  if (clinics.isLoading || me.isLoading) return <PageSkeleton />;
  if (clinics.isError)
    return <ErrorState error={clinics.error} onRetry={() => void clinics.refetch()} />;
  if (!clinics.data?.length) {
    return (
      <>
        <PortalHeader title={t('portal.book.title')} />
        <Card>
          <EmptyState
            title={t('portal.book.noClinics')}
            description={t('portal.book.noClinicsHint')}
          />
        </Card>
      </>
    );
  }

  const summary = (
    <Card sx={{ p: { xs: 4, md: 5 }, position: { md: 'sticky' }, top: { md: 88 } }}>
      <Typography variant="h5" component="h2" sx={{ mb: 3 }}>
        {t('portal.book.summary')}
      </Typography>
      <Stack spacing={2} sx={{ mb: 4 }}>
        <SummaryRow icon={<Stethoscope size={16} />} label={page.data?.name ?? '—'} />
        <SummaryRow
          icon={<Users size={16} />}
          label={files.find((f) => f.id === who)?.fullName ?? t('portal.book.newFileShort')}
        />
        <SummaryRow
          icon={<CalendarCheck size={16} />}
          label={
            type ? `${typeLabel(type)} · ${t('portal.book.minutes', { n: type.durationMin })}` : '—'
          }
        />
        <SummaryRow
          icon={<Clock size={16} />}
          label={
            slot
              ? `${formatDate(slot.start, lang, 'ddd LL')} · ${formatTime(slot.start, lang)} · ${dentistName(slot.dentistId)}`
              : t('portal.book.pickSlot')
          }
        />
      </Stack>
      <TextField
        label={t('portal.book.notes')}
        helperText={t('portal.book.notesHint')}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        multiline
        minRows={2}
        fullWidth
        inputProps={{ maxLength: 500, dir: 'auto' }}
        sx={{ mb: 4 }}
      />
      <Button
        fullWidth
        size="large"
        variant="contained"
        sx={patientCta}
        disabled={!slot || book.isPending}
        onClick={() => void confirm()}
      >
        {book.isPending ? t('portal.book.booking') : t('portal.book.confirm')}
      </Button>
      {page.data && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
          {t('portal.book.rules', { hours: page.data.rules.cancellationWindowHours })}
        </Typography>
      )}
    </Card>
  );

  return (
    <>
      <PortalHeader title={t('portal.book.title')} subtitle={t('portal.book.subtitle')} />
      <Grid container spacing={{ xs: 0, md: 5 }}>
        <Grid item xs={12} md={8} xl={9}>
          <Step n={1} title={t('portal.book.clinic')}>
            <TextField
              select
              fullWidth
              label={t('portal.book.chooseClinic')}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            >
              {clinics.data.map((c) => (
                <MenuItem key={c.slug} value={c.slug}>
                  <span dir="auto">{c.name}</span>
                  {c.address ? (
                    <Typography
                      component="span"
                      variant="body2"
                      color="text.secondary"
                      sx={{ mx: 2 }}
                    >
                      {c.address}
                    </Typography>
                  ) : null}
                </MenuItem>
              ))}
            </TextField>
          </Step>

          {page.isLoading ? (
            <Skeleton variant="rounded" height={280} />
          ) : page.isError ? (
            <ErrorState error={page.error} onRetry={() => void page.refetch()} />
          ) : page.data ? (
            <>
              <Step n={2} title={t('portal.book.who')}>
                <Grid container spacing={2}>
                  {files.map((f) => (
                    <Grid item xs={12} sm={6} lg={4} key={f.id}>
                      <Choice selected={who === f.id} onClick={() => setWho(f.id)}>
                        <Typography fontWeight={700} dir="auto" noWrap>
                          {f.fullName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t(`portal.common.${f.relation}`)} · <span dir="ltr">{f.fileNumber}</span>
                        </Typography>
                      </Choice>
                    </Grid>
                  ))}
                  {!files.some((f) => f.relation === 'self') && (
                    <Grid item xs={12} sm={6} lg={4}>
                      <Choice selected={who === ''} onClick={() => setWho('')}>
                        <Typography fontWeight={700}>{t('portal.book.newFileShort')}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t('portal.book.newFile')}
                        </Typography>
                      </Choice>
                    </Grid>
                  )}
                </Grid>
              </Step>

              <Step n={3} title={t('portal.book.service')}>
                {page.data.appointmentTypes.length === 0 ? (
                  <Alert severity="info">{t('portal.book.noServices')}</Alert>
                ) : (
                  <Grid container spacing={2}>
                    {page.data.appointmentTypes.map((x) => (
                      <Grid item xs={12} sm={6} lg={4} key={x.id}>
                        <Choice selected={typeId === x.id} onClick={() => setTypeId(x.id)}>
                          <Stack direction="row" spacing={2} alignItems="center">
                            <Box
                              sx={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                bgcolor: x.color,
                                flexShrink: 0,
                              }}
                            />
                            <Typography fontWeight={700} noWrap>
                              {typeLabel(x)}
                            </Typography>
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {t('portal.book.minutes', { n: x.durationMin })}
                          </Typography>
                        </Choice>
                      </Grid>
                    ))}
                  </Grid>
                )}
              </Step>

              <Step n={4} title={t('portal.book.dentist')}>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6} lg={4}>
                    <Choice selected={dentistId === ''} onClick={() => setDentistId('')}>
                      <Typography fontWeight={700}>{t('portal.book.any')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('portal.book.anyHint')}
                      </Typography>
                    </Choice>
                  </Grid>
                  {page.data.dentists.map((d) => (
                    <Grid item xs={12} sm={6} lg={4} key={d.id}>
                      <Choice selected={dentistId === d.id} onClick={() => setDentistId(d.id)}>
                        <Stack direction="row" spacing={2} alignItems="center">
                          <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: d.color }}>
                            {d.name.replace(/^(Dr\.?|د\.?)\s*/i, '').slice(0, 1)}
                          </Avatar>
                          <Typography fontWeight={700} dir="auto" noWrap>
                            {d.name}
                          </Typography>
                        </Stack>
                      </Choice>
                    </Grid>
                  ))}
                </Grid>
              </Step>

              <Step n={5} title={t('portal.book.when')}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
                  <IconButton
                    aria-label={t('portal.book.prevWeek')}
                    disabled={!canPrevWeek}
                    onClick={() =>
                      setWeekStart(dayjs(weekStart).subtract(7, 'day').format('YYYY-MM-DD'))
                    }
                  >
                    <ChevronRight
                      size={18}
                      style={{ transform: lang === 'ar' ? 'none' : 'scaleX(-1)' }}
                    />
                  </IconButton>
                  <Typography fontWeight={700} sx={{ flex: 1, textAlign: 'center' }}>
                    {formatDate(from, lang, 'D MMM')} – {formatDate(to, lang, 'D MMM YYYY')}
                  </Typography>
                  <IconButton
                    aria-label={t('portal.book.nextWeek')}
                    onClick={() =>
                      setWeekStart(dayjs(weekStart).add(7, 'day').format('YYYY-MM-DD'))
                    }
                  >
                    <ChevronLeft
                      size={18}
                      style={{ transform: lang === 'ar' ? 'none' : 'scaleX(-1)' }}
                    />
                  </IconButton>
                </Stack>
                {slots.isLoading ? (
                  <Skeleton variant="rounded" height={140} />
                ) : slots.isError ? (
                  <ErrorState error={slots.error} onRetry={() => void slots.refetch()} compact />
                ) : (
                  <>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: 'repeat(4, 1fr)', sm: 'repeat(7, 1fr)' },
                        gap: 1.5,
                        mb: 4,
                      }}
                      role="tablist"
                    >
                      {days.map((d) => {
                        const active = d.date === day;
                        const none = d.slots.length === 0;
                        return (
                          <Card
                            key={d.date}
                            variant="outlined"
                            sx={(th) => ({
                              borderWidth: 2,
                              borderColor: active ? 'primary.main' : 'divider',
                              bgcolor: active
                                ? alpha(th.palette.primary.main, 0.06)
                                : 'background.paper',
                              opacity: none ? 0.5 : 1,
                            })}
                          >
                            <CardActionArea
                              role="tab"
                              aria-selected={active}
                              disabled={none}
                              onClick={() => {
                                setDay(d.date);
                                setSlot(null);
                              }}
                              sx={{ py: 2, textAlign: 'center' }}
                            >
                              <Typography variant="caption" display="block">
                                {formatDate(d.date, lang, 'ddd')}
                              </Typography>
                              <Typography fontWeight={800}>
                                {formatDate(d.date, lang, 'D')}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {none
                                  ? '—'
                                  : t('portal.book.slotsCount', { count: d.slots.length })}
                              </Typography>
                            </CardActionArea>
                          </Card>
                        );
                      })}
                    </Box>
                    {daySlots.length === 0 ? (
                      <EmptyState
                        icon={<CalendarX size={28} />}
                        title={t('portal.book.noSlots')}
                        description={t('portal.book.noSlotsHint')}
                        compact
                      />
                    ) : (
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: {
                            xs: 'repeat(3, 1fr)',
                            sm: 'repeat(4, 1fr)',
                            lg: 'repeat(6, 1fr)',
                          },
                          gap: 1.5,
                        }}
                      >
                        {daySlots.map((s) => {
                          const active = slot?.start === s.start && slot.dentistId === s.dentistId;
                          return (
                            <Button
                              key={`${s.start}-${s.dentistId}`}
                              variant={active ? 'contained' : 'outlined'}
                              onClick={() => setSlot({ start: s.start, dentistId: s.dentistId })}
                              sx={{ flexDirection: 'column', py: 1.5, lineHeight: 1.2 }}
                            >
                              <span dir="ltr">{formatTime(s.start, lang)}</span>
                              {!dentistId && (
                                <Typography
                                  variant="caption"
                                  noWrap
                                  sx={{ maxWidth: '100%', opacity: 0.8 }}
                                >
                                  {dentistName(s.dentistId)}
                                </Typography>
                              )}
                            </Button>
                          );
                        })}
                      </Box>
                    )}
                  </>
                )}
              </Step>
            </>
          ) : null}
        </Grid>
        <Grid item xs={12} md={4} xl={3}>
          {summary}
        </Grid>
      </Grid>
    </>
  );
}

function SummaryRow({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <Stack direction="row" spacing={2} alignItems="flex-start">
      <Box sx={{ color: 'text.secondary', mt: 0.25 }}>{icon}</Box>
      <Typography variant="body2" dir="auto">
        {label}
      </Typography>
    </Stack>
  );
}
