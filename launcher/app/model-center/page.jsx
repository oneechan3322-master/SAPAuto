import ModelCenter from '../../components/model-center'

// Dashboard page for the Model Center: LLM selection, apply, upgrades.
// The whole access model stays as decided — the launcher runs open access.
export const metadata = { title: 'مركز النماذج — SAPAuto' }

export default function ModelsPage() {
  return <ModelCenter />
}
