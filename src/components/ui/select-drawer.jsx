import React, { useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function SelectDrawer({ options, value, onChange, placeholder = "اختر خيارًا", className = "" }) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find(opt => opt.value === value);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "w-full h-11 px-4 rounded-xl border border-input bg-background text-sm flex items-center justify-between hover:bg-muted transition-colors",
          className
        )}
      >
        <span className={selectedOption ? "text-foreground" : "text-muted-foreground"}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{placeholder}</DrawerTitle>
          </DrawerHeader>
          <div className="max-h-96 overflow-y-auto px-4 pb-6">
            <div className="space-y-2">
              {options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl text-left transition-colors border",
                    value === option.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border hover:bg-muted"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 pb-4">
            <DrawerClose asChild>
              <Button variant="outline" className="w-full rounded-xl">
                إلغاء
              </Button>
            </DrawerClose>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

export default SelectDrawer;