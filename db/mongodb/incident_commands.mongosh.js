// ReliefFlow — MongoDB commands for the incident-report document store.
// Runs on a SCRATCH database so real data is never touched:
//   docker exec -i reliefflow-mongo mongosh --quiet < db/mongodb/incident_commands.mongosh.js
// These are the same operations the application performs (src/app/api/incidents/route.ts).

const demo = db.getSiblingDB("reliefflow_commands_demo");
demo.dropDatabase();
print("== 1. CREATE collection with JSON-Schema validation ==");
demo.createCollection("incident_reports", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["disasterId", "reportedBy", "reportType", "description", "location", "severity", "createdAt", "updatedAt"],
      properties: {
        disasterId: { bsonType: ["int", "long", "double"], minimum: 1, description: "reference to PostgreSQL disasters.disaster_id" },
        reportedBy: { bsonType: ["int", "long", "double"], minimum: 1, description: "reference to PostgreSQL app_users.user_id" },
        reportType: { enum: ["DAMAGE", "MEDICAL", "SUPPLY", "SAFETY", "GENERAL"] },
        description: { bsonType: "string", minLength: 10, maxLength: 10000 },
        severity: { enum: ["LOW", "MODERATE", "HIGH", "CRITICAL"] },
        status: { enum: ["OPEN", "MONITORING", "RESOLVED"] },
        location: { bsonType: "object", required: ["label"], properties: { label: { bsonType: "string" }, latitude: { bsonType: ["double", "int"] }, longitude: { bsonType: ["double", "int"] } } },
        tags: { bsonType: "array", maxItems: 20, items: { bsonType: "string" } },
        updates: { bsonType: "array", items: { bsonType: "object", required: ["note", "by", "at"] } },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
      },
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});
const col = demo.incident_reports;

print("== 2. INDEXES: compound, status, weighted text ==");
col.createIndex({ disasterId: 1, createdAt: -1 });
col.createIndex({ reportType: 1, severity: 1 });
col.createIndex({ status: 1, createdAt: -1 });
col.createIndex({ description: "text", tags: "text", "location.label": "text" }, { weights: { description: 5, tags: 3, "location.label": 1 }, name: "incident_text" });
printjson(col.getIndexes().map((i) => i.name));

print("== 3. INSERT (create) ==");
const now = new Date();
col.insertMany([
  { disasterId: 11, reportedBy: 7, reportType: "MEDICAL", severity: "CRITICAL", status: "OPEN", description: "Cluster of acute diarrhoea among children at the school camp.", location: { label: "Aluva Government School Camp", latitude: 10.1, longitude: 76.35 }, tags: ["waterborne", "children"], updates: [], createdAt: now, updatedAt: now },
  { disasterId: 11, reportedBy: 7, reportType: "DAMAGE", severity: "HIGH", status: "OPEN", description: "Embankment breach flooded three wards overnight.", location: { label: "Aluva Riverside" }, tags: ["embankment"], updates: [], createdAt: now, updatedAt: now },
  { disasterId: 12, reportedBy: 7, reportType: "SUPPLY", severity: "HIGH", status: "MONITORING", description: "Camp at full capacity; tents and lanterns urgently required.", location: { label: "Majuli Satra Relief Camp" }, tags: ["tents", "overcrowding"], updates: [], createdAt: now, updatedAt: now },
]);
print("count:", col.countDocuments());

print("== 4. VALIDATION rejects a bad document ==");
try {
  col.insertOne({ disasterId: 11, reportedBy: 7, reportType: "OTHER", severity: "APOCALYPTIC", description: "short", location: { label: "X" }, createdAt: now, updatedAt: now });
} catch (e) {
  print("rejected:", e.code, e.errmsg);
}

print("== 5. READ: filter + projection + sort ==");
printjson(col.find({ severity: { $in: ["HIGH", "CRITICAL"] }, status: "OPEN" }, { _id: 0, reportType: 1, severity: 1, "location.label": 1 }).sort({ createdAt: -1 }).toArray());

print("== 6. TEXT SEARCH with relevance score ==");
printjson(col.find({ $text: { $search: "children water" } }, { _id: 0, description: 1, score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } }).toArray());

print("== 7. UPDATE: $set on an embedded field + $push into an embedded array ==");
printjson(col.updateOne({ reportType: "MEDICAL" }, { $set: { status: "MONITORING", "location.label": "Aluva Govt School Camp (Block B)", updatedAt: new Date() }, $push: { updates: { note: "Medical team dispatched", by: 6, at: new Date() } } }));

print("== 8. AGGREGATION pipelines ==");
printjson(col.aggregate([{ $group: { _id: "$severity", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray());
printjson(col.aggregate([{ $unwind: "$tags" }, { $group: { _id: "$tags", n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }]).toArray());
printjson(col.aggregate([{ $facet: { byType: [{ $group: { _id: "$reportType", n: { $sum: 1 } } }], byStatus: [{ $group: { _id: "$status", n: { $sum: 1 } } }], total: [{ $count: "n" }] } }]).toArray());
demo.disasters.insertMany([{ _id: 11, name: "Kerala Monsoon Floods" }, { _id: 12, name: "Assam Brahmaputra Flooding" }]);
printjson(col.aggregate([{ $group: { _id: "$disasterId", incidents: { $sum: 1 } } }, { $lookup: { from: "disasters", localField: "_id", foreignField: "_id", as: "d" } }, { $project: { _id: 0, disaster: { $first: "$d.name" }, incidents: 1 } }]).toArray());

print("== 9. QUERY PLAN: index scan vs collection scan ==");
const plan = (p) => { const out = []; const walk = (n) => { if (!n) return; out.push(n.stage + (n.indexName ? "(" + n.indexName + ")" : "")); walk(n.inputStage); }; walk(p.queryPlanner.winningPlan.queryPlan || p.queryPlanner.winningPlan); return out.join(" <- "); };
print("with index :", plan(col.find({ reportType: "MEDICAL", severity: "CRITICAL" }).explain()));
print("forced scan:", plan(col.find({ reportType: "MEDICAL", severity: "CRITICAL" }).hint({ $natural: 1 }).explain()));

print("== 10. DELETE ==");
printjson(col.deleteOne({ reportType: "DAMAGE" }));
print("count after delete:", col.countDocuments());

demo.dropDatabase();
print("scratch database dropped — done");
