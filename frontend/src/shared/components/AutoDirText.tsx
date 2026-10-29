import { Box, type BoxProps } from '@mui/material';

/** User data is shown exactly as typed; `dir="auto"` aligns Arabic or Latin text correctly. */
export function AutoDirText({ children, component = 'span', ...rest }: BoxProps & { component?: React.ElementType }) {
  return (
    <Box component={component} dir="auto" sx={{ unicodeBidi: 'plaintext' }} {...rest}>
      {children}
    </Box>
  );
}
