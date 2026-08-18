import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, XCircle, Undo2 } from 'lucide-react';
import { ApprovalAction, WorkflowEngine } from '@/lib/workflow-engine';
import { toast } from 'sonner';

interface ApprovalBarProps {
  recordId: string;
  tableName: string;
  canApprove: boolean;
  onStatusChange: () => void;
}

export function ApprovalBar({ recordId, tableName, canApprove, onStatusChange }: ApprovalBarProps) {
  const [remarks, setRemarks] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAction = async (action: ApprovalAction) => {
    setIsProcessing(true);
    try {
      await WorkflowEngine.processAction(recordId, tableName, action, remarks);
      toast.success(`Record successfully ${action}d.`);
      setRemarks('');
      onStatusChange();
    } catch (e) {
      toast.error(`Failed to perform action: ${action}`);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!canApprove) return null;

  return (
    <Card className="sticky bottom-4 left-0 right-0 p-4 shadow-lg border-primary/20 bg-background/95 backdrop-blur z-50 flex flex-col md:flex-row items-center gap-4 mt-6">
      <div className="flex-1 w-full">
        <Textarea 
          placeholder="Add remarks (required for reject/return)..." 
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          className="min-h-[40px] h-10 resize-none"
        />
      </div>
      <div className="flex gap-2 w-full md:w-auto">
        <Button 
          variant="outline" 
          className="flex-1 md:flex-none border-orange-200 text-orange-700 hover:bg-orange-50"
          disabled={isProcessing || !remarks}
          onClick={() => handleAction('return')}
        >
          <Undo2 className="w-4 h-4 mr-2" /> Return
        </Button>
        <Button 
          variant="outline" 
          className="flex-1 md:flex-none border-destructive text-destructive hover:bg-destructive/10"
          disabled={isProcessing || !remarks}
          onClick={() => handleAction('reject')}
        >
          <XCircle className="w-4 h-4 mr-2" /> Reject
        </Button>
        <Button 
          className="flex-1 md:flex-none bg-green-600 hover:bg-green-700"
          disabled={isProcessing}
          onClick={() => handleAction('approve')}
        >
          <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
        </Button>
      </div>
    </Card>
  );
}
