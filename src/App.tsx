import { useEffect, useState } from 'react';
import {
  Alert, AlertDescription, AlertIcon, AlertTitle, Box, Button, Container, Divider,
  FormControl, FormErrorMessage, FormLabel, Heading, Input, Radio, RadioGroup,
  Spinner, Stack, Text, Textarea, VStack,
} from '@chakra-ui/react';

const HAILER_API     = 'https://api.hailer.com';
const WORKFLOW_ID    = '6a75d152d4a89ea5abc6434e'; // Customer Feedback
// "Received" — NOT "Pending". Pending means "form sent, awaiting response"; by the
// time this component POSTs, the customer has already responded. Received is also
// the only phase with the team announcement enabled (enableAnnouncement: true) —
// creating into Pending meant that announcement never fired.
const PHASE_RECEIVED = '6a75d1aae4a862ee2e5e30c2';
const API_KEY        = import.meta.env.VITE_API_KEY || '';

// Customer Feedback fields
const F_TRIP      = '6a75d1ad6b5a2cae994e86b4';
const F_TICKET    = '6a75d1ad6b5a2cae994e86b7';
const F_NAME      = '6a75d1ad6b5a2cae994e86ba';
const F_EMAIL     = '6a75d1ad6b5a2cae994e86bd';
const F_ENGINEER  = '6a75d1ad6b5a2cae994e86c0';
const F_DATE      = '6a75d1ad6b5a2cae994e86c3';
const F_OVERALL   = '6a75d1ae6b5a2cae994e86c9';
const F_QUALITY   = '6a75d1ae6b5a2cae994e86cc';
const F_TECH      = '6a75d1ae6b5a2cae994e86cf';
const F_RECOMMEND = '6a75d1ae6b5a2cae994e86d2';
const F_COMMENTS  = '6a75d1ae6b5a2cae994e86d5';

// Trips IHS fields — read-only, used to resolve who the feedback request is for.
// Both already exist on TRIPS/IHS specifically for this: "Client Contact Person"
// links to the real Contact Persons record (name + email); "Client Contact Email"
// is the documented fallback when no contact person is on file.
const TRIP_WORKFLOW_ID = '6a211715b129621437c16b03';
const TRIP_CONTACT_PERSON = '6a799e8aef5cbedbd85d3631';
const TRIP_CONTACT_EMAIL  = '6a75d1557163b2968df43e2f';
// v3 has no "get one activity by id" endpoint — only activity.list scoped to a
// known phase. Trips can be in any of these, so we check each in turn until found.
const TRIP_PHASE_IDS = [
  '6a211716b129621437c16b0e', // Triage from Support Tickets
  '6a211716b129621437c16b0f', // Pre-travel Activities
  '6a211716b129621437c16b10', // Closed
  '6a211716b129621437c16b11', // In Progress
  '6a211716b129621437c16b12', // Follow-up Activities
  '6a211716b129621437c16b13', // Waiting on PO
  '6a211716b129621437c16b14', // Waiting on Dates
];

// Contact Persons fields — single-phase workflow, no iteration needed.
const CONTACT_WORKFLOW_ID = '6a041d0ffc4db70b8339c89a';
const CONTACT_PHASE_ID    = '6a041d0ffc4db70b8339c8e5';
const CONTACT_FIRST_NAME  = '6a041d0ffc4db70b8339c8e0';
const CONTACT_LAST_NAME   = '6a041d0ffc4db70b8339c8e1';
const CONTACT_EMAIL       = '6a041d0ffc4db70b8339c8c5';

interface RawActivity {
  _id: string;
  name?: string;
  fields?: Record<string, unknown>;
}

/**
 * v3's HTTP convention is POST <op-in-path> with args as a JSON array body —
 * NOT GET with the id appended to the path (that silently 404s/permission-denies,
 * since the server tries to parse the id as part of the method name). There's also
 * no "get one activity by id" endpoint at all in v3 — only activity.list, scoped to
 * a known processId + phaseId. This searches each candidate phase in turn.
 */
async function findActivityById(workflowId: string, phaseIds: string[], activityId: string): Promise<RawActivity | null> {
  for (const phaseId of phaseIds) {
    try {
      const res = await fetch(`${HAILER_API}/api/v3/activity/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', hlrkey: API_KEY },
        body: JSON.stringify([
          { processId: workflowId, phaseId },
          { limit: 200, includeUsers: false, includeTeams: false, includeActivityLinks: false },
        ]),
      });
      const data = await res.json();
      const found = (data?.activities as RawActivity[] | undefined)?.find(a => a._id === activityId);
      if (found) return found;
    } catch {
      // try the next phase
    }
  }
  return null;
}

const SATISFACTION_OPTIONS = [
  { value: '1 - Very Dissatisfied', label: '1 — Very Dissatisfied' },
  { value: '2 - Dissatisfied',      label: '2 — Dissatisfied' },
  { value: '3 - Neutral',           label: '3 — Neutral' },
  { value: '4 - Satisfied',         label: '4 — Satisfied' },
  { value: '5 - Very Satisfied',    label: '5 — Very Satisfied' },
];

const QUALITY_OPTIONS = [
  { value: '1 - Very Poor',  label: '1 — Very Poor' },
  { value: '2 - Poor',       label: '2 — Poor' },
  { value: '3 - Average',    label: '3 — Average' },
  { value: '4 - Good',       label: '4 — Good' },
  { value: '5 - Excellent',  label: '5 — Excellent' },
];

interface FormData {
  overall: string;
  quality: string;
  professionalism: string;
  recommend: string;
  comments: string;
}

interface Errors {
  overall?: string;
  quality?: string;
  professionalism?: string;
  recommend?: string;
  email?: string;
}

function validate(data: FormData, email: string): Errors {
  const errors: Errors = {};
  if (!data.overall)         errors.overall        = 'Please rate your overall satisfaction';
  if (!data.quality)         errors.quality        = 'Please rate the quality of service';
  if (!data.professionalism) errors.professionalism = 'Please rate technician professionalism';
  if (!data.recommend)       errors.recommend      = 'Please answer this question';
  if (!email.trim())         errors.email          = 'Please enter your email address';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Please enter a valid email address';
  return errors;
}

/** Activity-link field values come back as either a raw id string or { value: { _id } }
 *  depending on the endpoint — handle both rather than assuming one shape. */
function extractLinkId(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  const obj = raw as { value?: { _id?: string } | string; _id?: string };
  if (typeof obj.value === 'string') return obj.value;
  if (obj.value && typeof obj.value === 'object' && obj.value._id) return obj.value._id;
  if (obj._id) return obj._id;
  return undefined;
}

function extractFieldValue(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  const obj = raw as { value?: unknown };
  if (typeof obj.value === 'string') return obj.value;
  return undefined;
}

export default function App() {
  const [tripId, setTripId]           = useState('');
  const [ticketCode, setTicketCode]   = useState('');
  const [engineerId, setEngineerId]   = useState('');
  const [tripName, setTripName]       = useState('');
  const [loadingTrip, setLoadingTrip] = useState(false);
  const [tripError, setTripError]     = useState(false);
  const [clientName, setClientName]   = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [form, setForm]               = useState<FormData>({ overall: '', quality: '', professionalism: '', recommend: '', comments: '' });
  const [errors, setErrors]           = useState<Errors>({});
  const [status, setStatus]           = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg]       = useState('');

  // This form only makes sense tied to a specific service visit — it's what lets us
  // resolve who to thank/follow up with (via the Trip's linked Contact Person) and
  // what the feedback is actually about. No trip reference = invalid link, not a
  // degraded-but-usable generic form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const trip = params.get('trip') || '';
    const ticket = params.get('ticket') || '';
    const engineer = params.get('engineer') || '';
    setTripId(trip);
    setTicketCode(ticket);
    setEngineerId(engineer);

    if (!trip) { setTripError(true); return; }

    setLoadingTrip(true);
    (async () => {
      const tripActivity = await findActivityById(TRIP_WORKFLOW_ID, TRIP_PHASE_IDS, trip);
      if (!tripActivity) { setTripError(true); setLoadingTrip(false); return; }
      if (tripActivity.name) setTripName(tripActivity.name);

      const contactPersonId = extractLinkId(tripActivity.fields?.[TRIP_CONTACT_PERSON]);
      const fallbackEmail = extractFieldValue(tripActivity.fields?.[TRIP_CONTACT_EMAIL]);

      if (contactPersonId) {
        const cp = await findActivityById(CONTACT_WORKFLOW_ID, [CONTACT_PHASE_ID], contactPersonId);
        const first = extractFieldValue(cp?.fields?.[CONTACT_FIRST_NAME]) || '';
        const last = extractFieldValue(cp?.fields?.[CONTACT_LAST_NAME]) || '';
        const email = extractFieldValue(cp?.fields?.[CONTACT_EMAIL]) || '';
        setClientName(`${first} ${last}`.trim() || cp?.name || '');
        setClientEmail(email || fallbackEmail || '');
      } else if (fallbackEmail) {
        setClientEmail(fallbackEmail);
      }

      setLoadingTrip(false);
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(form, clientEmail);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setStatus('submitting');
    try {
      const now = Math.floor(Date.now() / 1000);
      const fields: Record<string, unknown> = {
        [F_TICKET]:    ticketCode,
        [F_NAME]:      clientName.trim(),
        [F_EMAIL]:     clientEmail.trim(),
        [F_DATE]:      now,
        [F_OVERALL]:   form.overall,
        [F_QUALITY]:   form.quality,
        [F_TECH]:      form.professionalism,
        [F_RECOMMEND]: form.recommend,
        [F_COMMENTS]:  form.comments,
      };
      if (tripId)     fields[F_TRIP]     = tripId;
      if (engineerId) fields[F_ENGINEER] = engineerId;

      const res = await fetch(`${HAILER_API}/api/v3/activity/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'hlrkey': API_KEY },
        body: JSON.stringify([
          WORKFLOW_ID,
          {
            name: `Feedback — ${tripName || ticketCode || 'Service Visit'} — ${clientName.trim() || 'Unknown'}`,
            phaseId: PHASE_RECEIVED,
            fields,
          },
        ]),
      });
      const data = await res.json();
      if (!data._id) throw new Error(data.msg || 'Submission failed');
      setStatus('success');
    } catch (err) {
      setErrorMsg(String(err));
      setStatus('error');
    }
  }

  if (tripError) {
    return (
      <Box minH="100vh" bg="black" display="flex" alignItems="center" justifyContent="center" p={6}>
        <Container maxW="md" textAlign="center">
          <Heading size="md" color="white" mb={8}>Thermetrics Europe Support Request</Heading>
          <Alert status="error" borderRadius="lg" flexDirection="column" p={10}
            bg="gray.900" border="1px" borderColor="gray.700">
            <AlertIcon boxSize={12} mb={4} color="red.300" />
            <AlertTitle fontSize="xl" mb={2} color="white">Link Not Valid</AlertTitle>
            <AlertDescription color="gray.400">
              This feedback link is missing its service visit reference, or the link has expired.
              Please use the link provided in your service visit confirmation email, or contact us directly.
            </AlertDescription>
          </Alert>
          <Text color="gray.600" fontSize="xs" mt={5}>© Thermetrics Europe Oy · support.europe@thermetrics.com</Text>
        </Container>
      </Box>
    );
  }

  if (status === 'success') {
    return (
      <Box minH="100vh" bg="black" display="flex" alignItems="center" justifyContent="center" p={6}>
        <Container maxW="md" textAlign="center">
          <Heading size="md" color="white" mb={8}>Thermetrics Europe Support Request</Heading>
          <Alert status="success" borderRadius="lg" flexDirection="column" p={10}
            bg="gray.900" border="1px" borderColor="gray.700">
            <AlertIcon boxSize={12} mb={4} color="green.300" />
            <AlertTitle fontSize="xl" mb={2} color="white">Thank You!</AlertTitle>
            <AlertDescription color="gray.400">
              Thank you for taking the time to provide your feedback. It helps us continually improve our service.<br /><br />
              Kind regards,<br />
              Your Thermetrics Europe Support Team
            </AlertDescription>
          </Alert>
          <Text color="gray.600" fontSize="xs" mt={5}>© Thermetrics Europe Oy · support.europe@thermetrics.com</Text>
        </Container>
      </Box>
    );
  }

  return (
    <Box minH="100vh" bg="black" py={12} px={4}>
      <Container maxW="lg">
        <Box textAlign="center" mb={8}>
          <Heading size="md" color="white">Thermetrics Europe Service Feedback</Heading>
          {loadingTrip ? (
            <Spinner size="sm" color="gray.400" mt={3} />
          ) : tripName ? (
            <Box mt={3} p={3} bg="gray.900" borderRadius="md" border="1px" borderColor="gray.700">
              <Text color="gray.400" fontSize="xs" mb={1}>You are rating the following service visit:</Text>
              <Text color="white" fontWeight="semibold">{tripName}</Text>
              {ticketCode && <Text color="gray.500" fontSize="xs" mt={1}>Ticket: {ticketCode}</Text>}
            </Box>
          ) : ticketCode ? (
            <Text color="gray.400" fontSize="sm" mt={2}>Reference: {ticketCode}</Text>
          ) : null}
        </Box>

        <Box bg="gray.900" borderRadius="xl" border="1px" borderColor="gray.700" p={8}>
          <Text color="gray.400" fontSize="sm" mb={6}>
            We value your feedback. Please take a moment to rate your recent service experience.
          </Text>

          {status === 'error' && (
            <Alert status="error" borderRadius="md" mb={6} bg="red.900" border="1px" borderColor="red.700">
              <AlertIcon color="red.300" />
              <AlertDescription color="red.200">{errorMsg || 'Something went wrong. Please try again.'}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <VStack spacing={6}>

              <FormControl>
                <FormLabel color="gray.300" fontWeight="semibold">Your Name <Text as="span" color="gray.500" fontWeight="normal">(optional)</Text></FormLabel>
                <Input
                  bg="gray.800" border="1px" borderColor="gray.600" color="white"
                  _placeholder={{ color: 'gray.500' }} _focus={{ borderColor: 'white', boxShadow: 'none' }}
                  placeholder="Your name"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                />
              </FormControl>

              <FormControl isInvalid={!!errors.email} isRequired>
                <FormLabel color="gray.300" fontWeight="semibold">Your Email</FormLabel>
                <Input
                  type="email"
                  bg="gray.800" border="1px" borderColor="gray.600" color="white"
                  _placeholder={{ color: 'gray.500' }} _focus={{ borderColor: 'white', boxShadow: 'none' }}
                  placeholder="you@company.com"
                  value={clientEmail}
                  onChange={e => { setClientEmail(e.target.value); setErrors(p => ({ ...p, email: undefined })); }}
                />
                <FormErrorMessage>{errors.email}</FormErrorMessage>
              </FormControl>

              <Divider borderColor="gray.700" />

              <FormControl isInvalid={!!errors.overall} isRequired>
                <FormLabel color="gray.300" fontWeight="semibold">Overall Satisfaction</FormLabel>
                <RadioGroup value={form.overall} onChange={v => { setForm(p => ({ ...p, overall: v })); setErrors(p => ({ ...p, overall: undefined })); }}>
                  <Stack spacing={2}>
                    {SATISFACTION_OPTIONS.map(o => (
                      <Radio key={o.value} value={o.value} colorScheme="blue">
                        <Text color="gray.300" fontSize="sm">{o.label}</Text>
                      </Radio>
                    ))}
                  </Stack>
                </RadioGroup>
                <FormErrorMessage>{errors.overall}</FormErrorMessage>
              </FormControl>

              <Divider borderColor="gray.700" />

              <FormControl isInvalid={!!errors.quality} isRequired>
                <FormLabel color="gray.300" fontWeight="semibold">Quality of Service</FormLabel>
                <RadioGroup value={form.quality} onChange={v => { setForm(p => ({ ...p, quality: v })); setErrors(p => ({ ...p, quality: undefined })); }}>
                  <Stack spacing={2}>
                    {QUALITY_OPTIONS.map(o => (
                      <Radio key={o.value} value={o.value} colorScheme="blue">
                        <Text color="gray.300" fontSize="sm">{o.label}</Text>
                      </Radio>
                    ))}
                  </Stack>
                </RadioGroup>
                <FormErrorMessage>{errors.quality}</FormErrorMessage>
              </FormControl>

              <Divider borderColor="gray.700" />

              <FormControl isInvalid={!!errors.professionalism} isRequired>
                <FormLabel color="gray.300" fontWeight="semibold">Technician Professionalism</FormLabel>
                <RadioGroup value={form.professionalism} onChange={v => { setForm(p => ({ ...p, professionalism: v })); setErrors(p => ({ ...p, professionalism: undefined })); }}>
                  <Stack spacing={2}>
                    {QUALITY_OPTIONS.map(o => (
                      <Radio key={o.value} value={o.value} colorScheme="blue">
                        <Text color="gray.300" fontSize="sm">{o.label}</Text>
                      </Radio>
                    ))}
                  </Stack>
                </RadioGroup>
                <FormErrorMessage>{errors.professionalism}</FormErrorMessage>
              </FormControl>

              <Divider borderColor="gray.700" />

              <FormControl isInvalid={!!errors.recommend} isRequired>
                <FormLabel color="gray.300" fontWeight="semibold">Would you recommend Thermetrics Europe to others?</FormLabel>
                <RadioGroup value={form.recommend} onChange={v => { setForm(p => ({ ...p, recommend: v })); setErrors(p => ({ ...p, recommend: undefined })); }}>
                  <Stack direction="row" spacing={6}>
                    {['Yes', 'No', 'Maybe'].map(v => (
                      <Radio key={v} value={v} colorScheme="blue">
                        <Text color="gray.300">{v}</Text>
                      </Radio>
                    ))}
                  </Stack>
                </RadioGroup>
                <FormErrorMessage>{errors.recommend}</FormErrorMessage>
              </FormControl>

              <Divider borderColor="gray.700" />

              <FormControl>
                <FormLabel color="gray.300" fontWeight="semibold">Additional Comments <Text as="span" color="gray.500" fontWeight="normal">(optional)</Text></FormLabel>
                <Textarea
                  placeholder="Please share any additional feedback..."
                  rows={4}
                  bg="gray.800" border="1px" borderColor="gray.600" color="white"
                  _placeholder={{ color: 'gray.500' }} _focus={{ borderColor: 'white', boxShadow: 'none' }}
                  value={form.comments}
                  onChange={e => setForm(p => ({ ...p, comments: e.target.value }))}
                />
              </FormControl>

              <Button type="submit" bg="white" color="black" size="lg" width="full"
                _hover={{ bg: 'gray.200' }} isLoading={status === 'submitting'} loadingText="Submitting...">
                Submit Feedback
              </Button>

            </VStack>
          </form>
        </Box>

        <Text textAlign="center" color="gray.600" fontSize="xs" mt={5}>
          © Thermetrics Europe Oy · support.europe@thermetrics.com
        </Text>
      </Container>
    </Box>
  );
}
