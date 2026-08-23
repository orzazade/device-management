import { useAuth } from '../lib/auth';

export default function Dashboard() {
  const { user } = useAuth();
  return (
    <div>
      <h1 className="text-xl font-bold">Hi, {user?.name.split(' ')[0]}</h1>
      <p className="text-neutral-500">
        Here’s the lab right now. (Devices and requests arrive in the next slices.)
      </p>
    </div>
  );
}
