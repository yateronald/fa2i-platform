'use client';
import { use } from 'react';
import ElectionManager from '@/components/election/ElectionManager';

export default function FederationElectionDetailPage({ params }) {
  const { id } = use(params);
  return <ElectionManager electionId={id} />;
}
