import { ComingSoon } from '../components/ComingSoon';
import { featureName } from '@/content/features';

export default function AIAssistant() {
  return <ComingSoon featureName={featureName('assistant')} />;
}
