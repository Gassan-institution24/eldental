import { fireEvent, render, screen, within } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { RHFSurfacesPicker, RHFTeethPicker, surfacesFor } from '../components/TeethPicker';

/** Teeth and surfaces are picked from a map; only surfaces that exist on the teeth are offered. */
let values: { teeth: string; surfaces: string } = { teeth: '', surfaces: '' };

function Harness({ teeth = '', surfaces = '' }: { teeth?: string; surfaces?: string }) {
  const form = useForm({ defaultValues: { teeth, surfaces } });
  values = form.watch();
  return (
    <FormProvider {...form}>
      <RHFTeethPicker name="teeth" label="Teeth" />
      <RHFSurfacesPicker name="surfaces" teethName="teeth" label="Surfaces" />
    </FormProvider>
  );
}

const openTeeth = () => fireEvent.click(screen.getByLabelText('Teeth'));
const openSurfaces = () => fireEvent.click(screen.getByLabelText('Surfaces'));

describe('surfacesFor', () => {
  it('offers O on back teeth, I and F on front teeth, and only shared ones for a mix', () => {
    expect(surfacesFor([16])).toEqual(['M', 'D', 'O', 'B', 'L', 'P']);
    expect(surfacesFor([11])).toEqual(['M', 'D', 'I', 'B', 'F', 'L', 'P']);
    expect(surfacesFor([11, 16])).toEqual(['M', 'D', 'B', 'L', 'P']);
  });
});

describe('RHFTeethPicker / RHFSurfacesPicker', () => {
  it('picks teeth by clicking the map', () => {
    render(<Harness />);
    openTeeth();
    const map = screen.getByRole('presentation');
    fireEvent.click(within(map).getByRole('button', { name: '36' }));
    fireEvent.click(within(map).getByRole('button', { name: '37' }));
    expect(values.teeth).toBe('36, 37');
    fireEvent.click(within(map).getByRole('button', { name: '36' }));
    expect(values.teeth).toBe('37');
  });

  it('asks for teeth before surfaces', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Surfaces')).toBeDisabled();
    expect(screen.getByText('Choose the teeth first')).toBeInTheDocument();
  });

  it('only offers surfaces that exist on the chosen tooth', () => {
    render(<Harness teeth="11" />);
    openSurfaces();
    const pop = screen.getByRole('presentation');
    expect(within(pop).queryByRole('button', { name: /Occlusal/ })).toBeNull();
    fireEvent.click(within(pop).getByRole('button', { name: /Incisal/ }));
    expect(values.surfaces).toBe('I');
  });

  it('drops a surface that no longer fits when the teeth change', () => {
    render(<Harness teeth="16" surfaces="MO" />);
    openTeeth();
    const map = screen.getByRole('presentation');
    fireEvent.click(within(map).getByRole('button', { name: '16' }));
    fireEvent.click(within(map).getByRole('button', { name: '11' }));
    expect(values.teeth).toBe('11');
    expect(values.surfaces).toBe('M');
  });
});
