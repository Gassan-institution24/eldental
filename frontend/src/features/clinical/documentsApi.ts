import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, postData } from '@/lib/api/axios';

/* ---------- medical certificates (07 §14) ---------- */

export type CertificateType = 'sick_leave' | 'medical_report' | 'attendance';

export type Certificate = {
  id: string;
  number: string;
  patientId: string;
  type: CertificateType;
  dentistId: string;
  dentistName?: string;
  appointmentId?: string;
  from: string;
  to: string;
  days: number;
  diagnosis?: string;
  body: string;
  recommendations?: string;
  issuedAt: string;
  status: 'issued' | 'void';
  voidReason?: string;
  voidedAt?: string;
};

export type CertificatePrint = {
  certificate: Certificate;
  patient: { fullName: string; fileNumber: string; dateOfBirth?: string; gender?: string };
  dentist: { name: string; licenseNumber?: string; primarySpecialty?: string; signatureFileId?: string; stampFileId?: string } | null;
  clinic: { name: string; phone?: string; email?: string; addressLine1?: string } | null;
};

const certKey = (patientId: string) => ['/patients', patientId, 'certificates'];

export function useCertificates(patientId: string) {
  return useQuery({ queryKey: certKey(patientId), queryFn: () => getData<Certificate[]>(`/patients/${patientId}/certificates`) });
}

export function useIssueCertificate(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Record<string, unknown>) => postData<Certificate>(`/patients/${patientId}/certificates`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: certKey(patientId) }),
  });
}

export function useVoidCertificate(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => postData<Certificate>(`/certificates/${id}/void`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: certKey(patientId) }),
  });
}

export const fetchCertificatePrint = (id: string) => getData<CertificatePrint>(`/certificates/${id}/print`);
