import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '../naf/ui/dialog.jsx';
import { Button } from '../naf/ui/button.jsx';

/**
 * تأكيد فعل — بنمط naf-terms.md §٤:
 * عنوان يسمّي الفعل، ونصّ يشرح أثره، وزرّ يحمل اسم الفعل لا «نعم».
 *
 * حلّ محلّ confirm() الأصلية: تلك تعرض نصّاً بلا تنسيق، وزرّيها
 * «OK/Cancel» بلغة المتصفّح لا بلغة الواجهة، ولا تقبل أي صياغة.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel = 'تأكيد',
  variant = 'destructive',
  onConfirm,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">إلغاء</Button>
          </DialogClose>
          <Button
            variant={variant}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
