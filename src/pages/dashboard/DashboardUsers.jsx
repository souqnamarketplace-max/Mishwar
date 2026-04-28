import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Users, Search, Shield, UserCheck, UserX, Mail, MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export default function DashboardUsers() {
  const [search, setSearch] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => base44.entities.User.list("-created_date", 50),
  });

  const filtered = users.filter((u) =>
    !search ||
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">إدارة المستخدمين</h1>
          <p className="text-sm text-muted-foreground">{users.length} مستخدم مسجل</p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الإيميل..."
              className="pr-10 rounded-xl"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">لا توجد نتائج</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="p-3">المستخدم</th>
                  <th className="p-3">الإيميل</th>
                  <th className="p-3">الصلاحية</th>
                  <th className="p-3">تاريخ التسجيل</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                          {user.full_name?.[0] || "؟"}
                        </div>
                        <span className="font-medium">{user.full_name || "—"}</span>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3.5 h-3.5" />
                        {user.email}
                      </span>
                    </td>
                    <td className="p-3">
                      <Badge className={user.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}>
                        {user.role === "admin" ? (
                          <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> مشرف</span>
                        ) : (
                          <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" /> مستخدم</span>
                        )}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground text-xs">
                      {user.created_date ? new Date(user.created_date).toLocaleDateString("ar") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}