import React, { useState, useRef } from 'react';
import { UploadCloud, FileSpreadsheet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface DragDropZoneProps {
  onFileSelect: (file: File) => void;
  isLoading?: boolean;
}

export function DragDropZone({ onFileSelect, isLoading }: DragDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndPassFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndPassFile(e.target.files[0]);
    }
  };

  const validateAndPassFile = (file: File) => {
    // 50 MB limit
    if (file.size > 50 * 1024 * 1024) {
      toast.error('File size exceeds 50MB limit');
      return;
    }
    
    const validTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/)) {
      toast.error('Only Excel (.xlsx, .xls) and CSV files are supported');
      return;
    }

    onFileSelect(file);
  };

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl transition-all cursor-pointer",
        isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 bg-muted/20 hover:bg-muted/50",
        isLoading && "opacity-50 pointer-events-none"
      )}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".xlsx, .xls, .csv"
        onChange={handleChange}
      />
      
      <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center space-y-4">
        <div className="p-4 rounded-full bg-primary/10 text-primary">
          <UploadCloud className="w-10 h-10" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">
            Click to upload or drag and drop
          </p>
          <p className="text-xs text-muted-foreground">
            Excel (.xlsx, .xls) or CSV up to 50MB
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
          disabled={isLoading}
        >
          Browse Files
        </Button>
      </div>
    </div>
  );
}
