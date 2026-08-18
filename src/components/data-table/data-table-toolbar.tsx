import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Filter, Download, FileSpreadsheet } from 'lucide-react';

export function DataTableToolbar() {
  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex items-center gap-2">
        <Input 
          placeholder="Filter records..." 
          className="h-8 w-[150px] lg:w-[250px]"
        />
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          <Filter className="mr-2 h-4 w-4" />
          Status
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 hidden lg:flex">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Export Excel
        </Button>
        <Button size="sm" className="h-8">
          <Download className="mr-2 h-4 w-4" />
          Export PDF
        </Button>
      </div>
    </div>
  );
}
