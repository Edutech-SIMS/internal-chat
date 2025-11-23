import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { getThemeColors } from "../../themes";

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}

interface Bill {
  id: string;
  bill_number: string;
  due_date: string;
  total_amount: number;
  status: string;
  description?: string;
}

interface FeeAccount {
  current_balance: number;
  opening_balance: number;
  status: string;
}

export default function BillingScreen() {
  const { user, profile } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [feeAccount, setFeeAccount] = useState<FeeAccount | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.id && profile?.school_id) {
      fetchParentStudents();
    }
  }, [user?.id, profile?.school_id]);

  const fetchParentStudents = async () => {
    try {
      const { data: links, error: linksError } = await supabase
        .from("parent_student_links")
        .select("student_id")
        .eq("parent_user_id", user?.id)
        .eq("school_id", profile?.school_id);

      if (linksError) throw linksError;

      if (!links || links.length === 0) {
        setStudents([]);
        setLoading(false);
        return;
      }

      const studentIds = links.map((link: any) => link.student_id);

      const { data: studentsData, error: studentsError } = await supabase
        .from("students")
        .select("id, first_name, last_name")
        .in("id", studentIds)
        .eq("school_id", profile?.school_id);

      if (studentsError) throw studentsError;

      setStudents(studentsData || []);

      if (studentsData && studentsData.length > 0) {
        setSelectedStudent(studentsData[0].id);
        fetchBillingData(studentsData[0].id);
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error("Error fetching students:", error);
      Alert.alert("Error", "Failed to load students");
      setLoading(false);
    }
  };

  const fetchBillingData = async (studentId: string) => {
    try {
      setLoading(true);
      
      // Fetch fee account
      const { data: accountData, error: accountError } = await supabase
        .from("fee_accounts")
        .select("*")
        .eq("student_id", studentId)
        .eq("school_id", profile?.school_id)
        .maybeSingle();

      if (accountError) throw accountError;
      setFeeAccount(accountData);

      // Fetch bills
      const { data: billsData, error: billsError } = await supabase
        .from("bills")
        .select("*")
        .eq("student_id", studentId)
        .eq("school_id", profile?.school_id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (billsError) throw billsError;
      setBills(billsData || []);

    } catch (error) {
      console.error("Error fetching billing data:", error);
      Alert.alert("Error", "Failed to load billing information");
    } finally {
      setLoading(false);
    }
  };

  const handleStudentSelect = (studentId: string) => {
    setSelectedStudent(studentId);
    fetchBillingData(studentId);
  };

  const formatCurrency = (amount: number) => {
    return `₵${amount.toFixed(2)}`;
  };

  const renderStudent = ({ item }: { item: Student }) => (
    <TouchableOpacity
      style={[
        styles.studentItem,
        { backgroundColor: colors.card, borderColor: colors.border },
        selectedStudent === item.id && { backgroundColor: colors.primary, borderColor: colors.primary },
      ]}
      onPress={() => handleStudentSelect(item.id)}
    >
      <Text
        style={[
          styles.studentName,
          { color: colors.text },
          selectedStudent === item.id && { color: "#fff" },
        ]}
      >
        {item.first_name} {item.last_name}
      </Text>
    </TouchableOpacity>
  );

  const renderBill = ({ item }: { item: Bill }) => (
    <View style={[styles.billCard, { backgroundColor: colors.card }]}>
      <View style={styles.billHeader}>
        <View>
          <Text style={[styles.billNumber, { color: colors.text }]}>{item.bill_number}</Text>
          <Text style={[styles.billDate, { color: colors.placeholderText }]}>
            Due: {new Date(item.due_date).toLocaleDateString()}
          </Text>
        </View>
        <View style={styles.billAmountContainer}>
          <Text style={[styles.billAmount, { color: colors.text }]}>
            {formatCurrency(item.total_amount)}
          </Text>
          <View style={[
            styles.statusBadge,
            { backgroundColor: item.status === 'paid' ? '#4CAF50' + '20' : '#F44336' + '20' }
          ]}>
            <Text style={[
              styles.statusText,
              { color: item.status === 'paid' ? '#4CAF50' : '#F44336' }
            ]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  if (loading && !selectedStudent) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Billing & Fees</Text>
      </View>

      {students.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="wallet-outline" size={60} color={colors.placeholderText} />
          <Text style={[styles.emptyText, { color: colors.text }]}>No students found</Text>
        </View>
      ) : (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.studentSelector}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Select Student</Text>
            <FlatList
              data={students}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              renderItem={renderStudent}
              contentContainerStyle={styles.studentListContent}
            />
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <>
              {feeAccount && (
                <View style={[styles.balanceCard, { backgroundColor: colors.card }]}>
                  <Text style={[styles.balanceLabel, { color: colors.placeholderText }]}>Current Balance</Text>
                  <Text style={[
                    styles.balanceAmount,
                    { color: feeAccount.current_balance > 0 ? '#F44336' : '#4CAF50' }
                  ]}>
                    {formatCurrency(feeAccount.current_balance)}
                  </Text>
                  <View style={styles.balanceRow}>
                    <Text style={[styles.balanceSubtext, { color: colors.placeholderText }]}>
                      Opening Balance: {formatCurrency(feeAccount.opening_balance)}
                    </Text>
                    <View style={[
                      styles.accountStatusBadge,
                      { backgroundColor: feeAccount.status === 'active' ? '#4CAF50' + '20' : '#FF9800' + '20' }
                    ]}>
                      <Text style={[
                        styles.accountStatusText,
                        { color: feeAccount.status === 'active' ? '#4CAF50' : '#FF9800' }
                      ]}>
                        {feeAccount.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              <View style={styles.billsSection}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Bills</Text>
                {bills.length > 0 ? (
                  bills.map(bill => (
                    <View key={bill.id} style={{ marginBottom: 12 }}>
                      {renderBill({ item: bill })}
                    </View>
                  ))
                ) : (
                  <View style={styles.noBillsContainer}>
                    <Text style={[styles.noBillsText, { color: colors.placeholderText }]}>
                      No billing history found
                    </Text>
                  </View>
                )}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
  },
  content: {
    flex: 1,
    padding: 20,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    marginTop: 12,
  },
  studentSelector: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  studentListContent: {
    paddingRight: 20,
  },
  studentItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
  },
  studentName: {
    fontSize: 14,
    fontWeight: "500",
  },
  balanceCard: {
    padding: 20,
    borderRadius: 16,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  balanceLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 16,
  },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  balanceSubtext: {
    fontSize: 12,
  },
  accountStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  accountStatusText: {
    fontSize: 10,
    fontWeight: "bold",
  },
  billsSection: {
    marginBottom: 20,
  },
  billCard: {
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  billHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  billNumber: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  billDate: {
    fontSize: 12,
  },
  billAmountContainer: {
    alignItems: "flex-end",
  },
  billAmount: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "bold",
  },
  noBillsContainer: {
    padding: 20,
    alignItems: "center",
  },
  noBillsText: {
    fontSize: 14,
  },
});
