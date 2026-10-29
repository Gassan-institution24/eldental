import { Button } from '@mui/material';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '@/lib/api/apiError';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import { personName, phone } from '@/shared/generated/validation/fields';
import { Form } from '../Form';
import { RHFTextField } from '../RHFTextField';
import { useAppForm } from '../useAppForm';

const schema = z.object({ firstName: personName(), mobile: phone({ mobile: true }) });
type Values = z.infer<typeof schema>;

function TestForm({ onSubmit }: { onSubmit: (v: Values) => Promise<void> | void }) {
  const form = useAppForm<Values>({ schema, defaultValues: { firstName: '', mobile: '' } });
  return (
    <Form form={form} name="test.form" onSubmit={onSubmit}>
      <RHFTextField name="firstName" label="First name" required />
      <RHFTextField name="mobile" label="Mobile" required />
      <Button type="submit">Save</Button>
    </Form>
  );
}

function renderForm(onSubmit: (v: Values) => Promise<void> | void) {
  const router = createMemoryRouter([{ path: '/', element: <TestForm onSubmit={onSubmit} /> }]);
  return render(
    <AppThemeProvider>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </AppThemeProvider>,
  );
}

describe('<Form> validation UX (16 §5.2)', () => {
  it('shows the error on blur, not while typing, and clears it on change', async () => {
    const user = userEvent.setup();
    renderForm(vi.fn());
    const input = screen.getByLabelText(/First name/);
    await user.type(input, 'A');
    expect(screen.queryByText(/at least 2 characters/)).not.toBeInTheDocument();
    await user.tab();
    expect(await screen.findByText('First name must be at least 2 characters')).toBeInTheDocument();
    await user.type(input, 'hmad');
    await waitFor(() => expect(screen.queryByText(/at least 2 characters/)).not.toBeInTheDocument());
  });

  it('on submit shows a summary and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(onSubmit);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('2 fields need attention')).toBeInTheDocument();
    expect(screen.getByText('First name is required')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/First name/)).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('normalises values before submit (Arabic digits → E.164)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(onSubmit);
    await user.type(screen.getByLabelText(/First name/), '  أحمد  ');
    await user.type(screen.getByLabelText(/Mobile/), '٠٧٩١٢٣٤٥٦٧');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ firstName: 'أحمد', mobile: '+962791234567' }));
  });

  it('maps server 422 errors onto the matching fields', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', { fields: [{ path: 'mobile', code: 'duplicate' }] }),
    );
    renderForm(onSubmit);
    await user.type(screen.getByLabelText(/First name/), 'Sara');
    await user.type(screen.getByLabelText(/Mobile/), '0791234567');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This value is already used')).toBeInTheDocument();
  });

  it('shows business errors as an alert with the reference code', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(409, 'APPOINTMENT_SLOT_TAKEN', 'taken', undefined, 'req-123'));
    renderForm(onSubmit);
    await user.type(screen.getByLabelText(/First name/), 'Sara');
    await user.type(screen.getByLabelText(/Mobile/), '0791234567');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/just booked by someone else/)).toBeInTheDocument();
    expect(screen.getByText('Reference code: req-123')).toBeInTheDocument();
  });
});
